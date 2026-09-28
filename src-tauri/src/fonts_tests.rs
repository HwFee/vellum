use crate::fonts::{fs_csb_is_cjk, insert_family, into_sorted, normalize_family_name};
use std::collections::BTreeMap;

/// UTF-16 字面 → Option<String>：以 0 结尾的定长缓冲要在这里归位
#[test]
fn normalize_family_name_trims_at_nul_and_rejects_empty() {
    let raw = [0x5B8Bu16, 0x4F53u16, 0, 0x0041u16]; // 「宋体」+ NUL + 垃圾尾部
    assert_eq!(normalize_family_name(&raw).as_deref(), Some("宋体"));

    assert_eq!(normalize_family_name(&[0, 0x41]), None);
    assert_eq!(normalize_family_name(&[]), None);
    assert_eq!(normalize_family_name(&[0x20, 0x20, 0]), None);
}

/// 竖排族名（`@` 开头）不进候选表：否则列表里会出现 `@宋体` / `宋体` 成对条目
#[test]
fn normalize_family_name_skips_vertical_variants() {
    let raw = [0x0040u16, 0x5B8Bu16, 0x4F53u16, 0]; // "@宋体"
    assert_eq!(normalize_family_name(&raw), None);
}

/// 同名族的标记取并集：GB2312 那趟判出 cjk、DEFAULT 那趟判出 mono 都要留住
#[test]
fn insert_family_merges_flags_for_same_name() {
    let mut map: BTreeMap<String, crate::fonts::FontFlags> = BTreeMap::new();
    insert_family(&mut map, "Sarasa Mono SC", false, true);
    insert_family(&mut map, "Sarasa Mono SC", true, false);

    let fonts = into_sorted(map);
    assert_eq!(fonts.len(), 1, "同名族只应留下一条");
    assert_eq!(fonts[0].name, "Sarasa Mono SC");
    assert!(fonts[0].cjk, "cjk 标记应被并集保留");
    assert!(fonts[0].mono, "mono 标记应被并集保留");
}

/// 输出按族名排序且字段一一对应（前端候选表的稳定顺序由这里兜底）
#[test]
fn into_sorted_returns_name_ordered_entries() {
    let mut map: BTreeMap<String, crate::fonts::FontFlags> = BTreeMap::new();
    insert_family(&mut map, "Georgia", false, false);
    insert_family(&mut map, "Consolas", false, true);

    let fonts = into_sorted(map);
    let names: Vec<&str> = fonts.iter().map(|font| font.name.as_str()).collect();
    assert_eq!(names, vec!["Consolas", "Georgia"]);
    assert!(fonts[0].mono && !fonts[0].cjk);
    assert!(!fonts[1].mono && !fonts[1].cjk);
}

/// fsCsb[0] 的 CJK 判定：日/简中/韩/繁中/韩 Johab 任意一位命中即算 CJK 字体
#[test]
fn fs_csb_is_cjk_recognizes_cjk_codepages() {
    for bit in [17u32, 18, 19, 20, 21] {
        assert!(fs_csb_is_cjk(1 << bit), "bit {bit} 应判 CJK");
    }
    // 拉丁/符号等其它代码页位都不算
    assert!(!fs_csb_is_cjk(0));
    assert!(!fs_csb_is_cjk(1 << 0)); // 1252 Latin 1
    assert!(!fs_csb_is_cjk(1 << 16)); // 874 Thai
    assert!(!fs_csb_is_cjk(1 << 31)); // 符号
    // 组合位：CJK 位混入其它位仍命中；全非 CJK 位不命中
    assert!(fs_csb_is_cjk((1 << 0) | (1 << 18)));
    assert!(!fs_csb_is_cjk((1 << 0) | (1 << 16)));
}

/// 真机枚举的标记回归：CJK 签名给中文字体打标，Ebrima 这类大字库不再误标
#[cfg(windows)]
#[test]
fn collect_system_fonts_flags_cjk_by_font_signature() {
    let fonts = crate::fonts::collect_system_fonts();
    let flag = |name: &str| fonts.iter().find(|f| f.name == name).map(|f| f.cjk);
    assert_eq!(flag("宋体"), Some(true), "宋体应标 cjk");
    assert_eq!(flag("微软雅黑"), Some(true), "微软雅黑应标 cjk");
    // Ebrima / Gadugi / Leelawadee / Lucida Sans Unicode 是换签名判定前
    // 被误标「中文」的那批大字库——有装就断言它没标上
    for name in ["Ebrima", "Gadugi", "Leelawadee", "Lucida Sans Unicode"] {
        if let Some(cjk) = flag(name) {
            assert!(!cjk, "{name} 不该标 cjk");
        }
    }
    assert_eq!(flag("Segoe UI"), Some(false));
    assert_eq!(flag("Arial"), Some(false));
}

/// 真机枚举：Windows 上至少要能列出系统字体（全新机器也有 Arial）
#[cfg(windows)]
#[test]
fn collect_system_fonts_lists_installed_fonts() {
    let fonts = crate::fonts::collect_system_fonts();
    assert!(!fonts.is_empty(), "GDI 枚举不该返回空表");
    assert!(
        fonts.iter().any(|font| font.name == "Arial"),
        "Arial 是 Windows 的常备字体"
    );
    assert!(
        fonts.iter().any(|font| font.name == "宋体" || font.name == "SimSun"),
        "简体中文环境下应能列到宋体族之一"
    );
    assert!(
        !fonts.iter().any(|font| font.name.starts_with('@')),
        "竖排变体不该进候选表"
    );
}
