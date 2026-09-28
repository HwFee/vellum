//! 本机字体枚举（设置页「中文字体 / 西文字体 / 代码字体」三个槽位的候选表）。
//!
//! 应用只随包两款字体（`public/fonts/`：倉頡楷體、JetBrains Mono），其余候选项一律
//! 现场问系统要——**不扫描字体文件、不解析字体表**，只取「系统认定的字体族名」，
//! 与用户能在其它软件里选到的那一份保持一致。
//!
//! - Windows：GDI `EnumFontFamiliesExW`。多趟枚举——DEFAULT_CHARSET 收全表，
//!   再按 GB2312 / CHINESEBIG5 / SHIFTJIS / HANGUL / JOHAB 各走一趟，能出现在后几趟
//!   里的即判为「有 CJK 字形」；等宽与否看 `lfPitchAndFamily` 的 FIXED_PITCH 位。
//! - Linux：`fc-list : family`（fontconfig 命令行，装了浏览器引擎的机器一定有）。
//!   拿不到就返回空表——设置页只剩随包两款，不报错。
//!
//! 标记（cjk / mono）只用于**排序与标签**，不做过滤：候选表里宁可多，不可少
//! （过滤掉的那款往往正是用户要找的）。

use std::collections::BTreeMap;

/// 字体三槽的候选条目。字段与前端 `src/lib/fonts.ts` 的 SystemFont 一一对应。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SystemFont {
    pub name: String,
    /// 该字体有 CJK 字形（按 charset 枚举判定）
    pub cjk: bool,
    /// 等宽字体（按 FIXED_PITCH 判定）
    pub mono: bool,
}

/// 单个字体族的累计标记（同一族可能在多趟枚举里各出现一次）
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct FontFlags {
    cjk: bool,
    mono: bool,
}

/// 字体族名的规范化：UTF-16 → String，去空串、去竖排变体（`@` 开头）。
/// 竖排族名是 GDI 为同一款字体的竖排字形另立的一族，列进候选表只会让列表里
/// 出现一对同名条目（`@宋体` / `宋体`）——用户要的永远是横排那一款。
/// 只有 Windows 收集器产 UTF-16 字面；单测直接测它，故非 Windows 下只在测试构建编入。
#[cfg(any(windows, test))]
pub(crate) fn normalize_family_name(raw: &[u16]) -> Option<String> {
    let end = raw.iter().position(|unit| *unit == 0).unwrap_or(raw.len());
    if end == 0 {
        return None;
    }
    let name = String::from_utf16_lossy(&raw[..end]);
    let name = name.trim();
    if name.is_empty() || name.starts_with('@') {
        return None;
    }
    Some(name.to_string())
}

/// 并入一族：同名取标记的并集（GB2312 那趟标 cjk、DEFAULT 那趟标 mono 的情形都有）
pub(crate) fn insert_family(
    map: &mut BTreeMap<String, FontFlags>,
    name: &str,
    cjk: bool,
    mono: bool,
) {
    let entry = map.entry(name.to_string()).or_default();
    entry.cjk |= cjk;
    entry.mono |= mono;
}

/// BTreeMap → 按名字排序的候选表（BTreeMap 本身有序，这里只做一次搬运）
pub(crate) fn into_sorted(map: BTreeMap<String, FontFlags>) -> Vec<SystemFont> {
    map.into_iter()
        .map(|(name, flags)| SystemFont {
            name,
            cjk: flags.cjk,
            mono: flags.mono,
        })
        .collect()
}

/// 前端命令：本机已装字体（与随包字体合并是前端的事——那边才知道随包的是哪两款）。
/// 枚举是同步阻塞活（Windows 六趟 GDI 枚举 / Linux 的 fc-list 子进程），挪到
/// blocking 池跑——`async fn` 命令体跑在 async runtime 上，阻塞它会拖住所有在途 IPC。
#[tauri::command]
pub async fn list_system_fonts() -> Vec<SystemFont> {
    tauri::async_runtime::spawn_blocking(collect_system_fonts)
        .await
        .unwrap_or_default()
}

/// FONTSIGNATURE.fsCsb[0] 的 CJK 代码页位：日文 932（bit 17）/ 简中 936（18）/
/// 韩文 Wansung 949（19）/ 繁中 950（20）/ 韩文 Johab 1361（21）。
/// 非 Windows 的非测试构建没有调用方（Windows 收集器才产签名）——与
/// normalize_family_name 同一个 cfg 门。
#[cfg(any(windows, test))]
pub(crate) const FSCSB_CJK_MASK: u32 = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20) | (1 << 21);

#[cfg(any(windows, test))]
pub(crate) fn fs_csb_is_cjk(fs_csb0: u32) -> bool {
    fs_csb0 & FSCSB_CJK_MASK != 0
}

#[cfg(windows)]
pub(crate) fn collect_system_fonts() -> Vec<SystemFont> {
    let mut map: BTreeMap<String, FontFlags> = BTreeMap::new();
    enumerate_all_fonts(&mut map);
    into_sorted(map)
}

/// 一趟 DEFAULT_CHARSET 收全表。cjk 判定不看枚举趟——按字符集分趟跑会被 GDI
/// 的字体链接/替换污染（Ebrima、Gadugi、Leelawadee、Lucida Sans Unicode 这类
/// 大字库在中文趟里也会出现）；改看每款字体自己的签名 fsCsb[0] 代码页位。
#[cfg(windows)]
fn enumerate_all_fonts(map: &mut BTreeMap<String, FontFlags>) {
    use windows_sys::Win32::Globalization::NEWTEXTMETRICEXW;
    use windows_sys::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, LOGFONTW, TEXTMETRICW, TRUETYPE_FONTTYPE,
    };

    /// lfPitchAndFamily 的低位：定宽（wingdi.h 的 FIXED_PITCH）
    const FIXED_PITCH: u8 = 0x01;
    /// DEFAULT_CHARSET：空 lfFaceName + 默认字符集 = 枚举全部字体族
    const DEFAULT_CHARSET: u8 = 1;

    /// 回调的取数袋：GDI 的枚举回调不能捕获环境，只能经 lParam 递一根裸指针进来。
    struct Collector<'a> {
        map: &'a mut BTreeMap<String, FontFlags>,
    }

    unsafe extern "system" fn callback(
        logfont: *const LOGFONTW,
        metric: *const TEXTMETRICW,
        font_type: u32,
        lparam: isize,
    ) -> i32 {
        if lparam == 0 || logfont.is_null() {
            return 1;
        }
        let collector = &mut *(lparam as *mut Collector<'_>);
        let logfont = &*logfont;
        if let Some(name) = normalize_family_name(&logfont.lfFaceName) {
            let mono = logfont.lfPitchAndFamily & FIXED_PITCH != 0;
            // TrueType/OpenType 趟递进来的其实是 NEWTEXTMETRICEXW（签名在尾巴上，
            // 前缀布局与 TEXTMETRICW 兼容，直接换型读）；位图/矢量字体没有签名，
            // 对 cjk 保守判 false——它们本就不可能是中文字面
            let cjk = !metric.is_null()
                && font_type & TRUETYPE_FONTTYPE != 0
                && fs_csb_is_cjk(
                    (*(metric as *const NEWTEXTMETRICEXW))
                        .ntmFontSig
                        .fsCsb[0],
                );
            insert_family(collector.map, &name, cjk, mono);
        }
        // 1 = 继续枚举
        1
    }

    unsafe {
        let hdc = GetDC(std::ptr::null_mut());
        if hdc.is_null() {
            return;
        }
        let mut collector = Collector { map };
        let mut logfont: LOGFONTW = std::mem::zeroed();
        logfont.lfCharSet = DEFAULT_CHARSET;
        // dwFlags = 0：不加任何字体类型筛选（TrueType / 位图 / 矢量全要）
        EnumFontFamiliesExW(
            hdc,
            &logfont,
            Some(callback),
            &mut collector as *mut Collector<'_> as isize,
            0,
        );
        ReleaseDC(std::ptr::null_mut(), hdc);
    }
}

/// fc-list 的一次拉取：返回规范化（去空白/拆分逗号族名）后的族名集合
#[cfg(target_os = "linux")]
fn fc_list_families(pattern: &str) -> std::collections::HashSet<String> {
    use std::process::Command;

    let mut out = std::collections::HashSet::new();
    let Ok(output) = Command::new("fc-list")
        .args([pattern, "family"])
        .output()
    else {
        return out;
    };
    if !output.status.success() {
        return out;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        // 一行可能是「族名1,族名2」（同一个字体文件里的多个族名），逐个收下
        for family in line.split(',') {
            let name = family.trim();
            if !name.is_empty() {
                out.insert(name.to_string());
            }
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn collect_system_fonts() -> Vec<SystemFont> {
    // cjk / mono 判定走 fontconfig 的语言与间距查询，不猜名字：
    // 「:lang=zh」是中文（含覆盖到 CJK 的日韩字体），「:spacing=mono」是真等宽
    let zh = fc_list_families(":lang=zh");
    let mono = fc_list_families(":spacing=mono");
    let mut map: BTreeMap<String, FontFlags> = BTreeMap::new();
    for name in fc_list_families(":") {
        insert_family(&mut map, &name, zh.contains(&name), mono.contains(&name));
    }
    into_sorted(map)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn collect_system_fonts() -> Vec<SystemFont> {
    Vec::new()
}
