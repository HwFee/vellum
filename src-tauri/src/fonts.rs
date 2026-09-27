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

#[cfg(windows)]
pub(crate) fn collect_system_fonts() -> Vec<SystemFont> {
    let mut map: BTreeMap<String, FontFlags> = BTreeMap::new();
    // 全部字符集各走一趟：第一趟收全表，其余几趟用来给 CJK 字体打标
    for charset in CHARSET_PASSES {
        enumerate_charset(*charset, &mut map);
    }
    into_sorted(map)
}

/// 各趟枚举的字符集：DEFAULT_CHARSET（1）收全表；其余为中/日/韩字符集，
/// 能出现在这些趟里的字体即有对应字形
#[cfg(windows)]
const CHARSET_PASSES: &[u8] = &[
    1,   // DEFAULT_CHARSET
    134, // GB2312_CHARSET（简体中文）
    136, // CHINESEBIG5_CHARSET（繁体中文）
    128, // SHIFTJIS_CHARSET（日文）
    129, // HANGUL_CHARSET（韩文）
    130, // JOHAB_CHARSET（韩文 Johab）
];
#[cfg(windows)]
fn enumerate_charset(charset: u8, map: &mut BTreeMap<String, FontFlags>) {
    use windows_sys::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, LOGFONTW, TEXTMETRICW,
    };

    /// lfPitchAndFamily 的低四位：定宽（wingdi.h 的 FIXED_PITCH）
    const FIXED_PITCH: u8 = 0x01;
    /// DEFAULT_CHARSET：收全表的那趟（不带 cjk 判定）
    const DEFAULT_CHARSET_PASS: u8 = 1;

    /// 回调的取数袋：GDI 的枚举回调不能捕获环境，只能经 lParam 递一根裸指针进来。
    /// cjk 标记随趟而定，坐在这里一起递进去（不是全局状态，一趟一枚）。
    struct Collector<'a> {
        map: &'a mut BTreeMap<String, FontFlags>,
        /// 本趟是否算「有 CJK 字形」（非 DEFAULT_CHARSET 的那几趟都算）
        cjk_pass: bool,
    }

    unsafe extern "system" fn callback(
        logfont: *const LOGFONTW,
        _metric: *const TEXTMETRICW,
        _font_type: u32,
        lparam: isize,
    ) -> i32 {
        if lparam == 0 || logfont.is_null() {
            return 1;
        }
        let collector = &mut *(lparam as *mut Collector<'_>);
        let logfont = &*logfont;
        if let Some(name) = normalize_family_name(&logfont.lfFaceName) {
            let mono = logfont.lfPitchAndFamily & FIXED_PITCH != 0;
            insert_family(collector.map, &name, collector.cjk_pass, mono);
        }
        // 1 = 继续枚举
        1
    }

    unsafe {
        let hdc = GetDC(std::ptr::null_mut());
        if hdc.is_null() {
            return;
        }
        let mut collector = Collector {
            map,
            cjk_pass: charset != DEFAULT_CHARSET_PASS,
        };
        let mut logfont: LOGFONTW = std::mem::zeroed();
        logfont.lfCharSet = charset;
        // dwFlags = 0：不加任何字体类型筛选（TrueType / 位图 / 矢量全要）；
        // 空 lfFaceName + 非零 lfCharSet = 「按字符集枚举该集合下的字体族」
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

#[cfg(target_os = "linux")]
fn collect_system_fonts() -> Vec<SystemFont> {
    use std::process::Command;

    let output = match Command::new("fc-list").args([":", "family"]).output() {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut map: BTreeMap<String, FontFlags> = BTreeMap::new();
    for line in text.lines() {
        // 一行可能是「族名1,族名2」（同一个字体文件里的多个族名），逐个收下
        for family in line.split(',') {
            let name = family.trim();
            if name.is_empty() {
                continue;
            }
            // fontconfig 这条路拿不到字符集/间距信息：等宽按名字粗判，CJK 一律标 false
            let mono = name.to_lowercase().contains("mono");
            insert_family(&mut map, name, false, mono);
        }
    }
    into_sorted(map)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn collect_system_fonts() -> Vec<SystemFont> {
    Vec::new()
}
