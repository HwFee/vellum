//! 将本应用注册为 Markdown 文件的 ProgID 处理器（用户级，免管理员）。
//!
//! Windows「打开方式 → 始终使用此应用」只有指向一个**已注册的 ProgID** 时才能
//! 固化为默认处理器；裸 `Applications\<exe>` 只支持「仅此一次」。本模块在启动时
//! 确保 `Markdown Document` ProgID 指向当前可执行文件，使开发版与安装版都能被
//! 永久关联。全部写入 `HKCU\Software\Classes`，无需管理员权限。
//!
//! 机器级 `HKLM\SOFTWARE\Classes\.md` 的默认值本就指向 `Markdown Document`（由
//! Tauri 安装器声明），但 ProgID 键缺失导致悬空；这里在用户级补回 ProgID，悬空
//! 引用即解析到本应用。

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::process::Command;

/// Windows 进程创建标志：不创建可见的控制台窗口。
/// 防止 `reg.exe` 在 Windows 11 上弹出 Windows Terminal 窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
const PROG_ID: &str = "Markdown Document";
#[cfg(windows)]
const PROG_ID_DESC: &str = "Markdown document";
#[cfg(windows)]
const EXTENSIONS: &[&str] = &[".md", ".markdown"];

/// 创建一个带有 `CREATE_NO_WINDOW` 标志的 `reg` 命令，避免弹出终端窗口。
#[cfg(windows)]
fn reg_command(args: &[&str]) -> Command {
    let mut cmd = Command::new("reg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(args);
    cmd
}

/// 设置注册表项的默认（无名）值为 REG_SZ。`reg add` 会在项不存在时一并创建。
#[cfg(windows)]
fn reg_set_default(key: &str, data: &str) {
    let _ = reg_command(&["add", key, "/ve", "/t", "REG_SZ", "/d", data, "/f"]).status();
}

/// 在注册表项下写入一个 REG_NONE 零长值（OpenWithProgids 条目约定为该类型）。
#[cfg(windows)]
fn reg_set_none(key: &str, name: &str) {
    let _ = reg_command(&["add", key, "/v", name, "/t", "REG_NONE", "/f"]).status();
}

/// 读取注册表项的默认值。项或值不存在时返回 `None`。
#[cfg(windows)]
fn reg_query_default(key: &str) -> Option<String> {
    let out = reg_command(&["query", key, "/ve"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|l| l.contains("(Default)"))
        .and_then(|l| l.split_once("REG_SZ"))
        .map(|(_, data)| data.trim().to_string())
}

/// 注册 `Markdown Document` ProgID 指向当前可执行文件，并把该 ProgID 登记到
/// `.md` / `.markdown` 的 OpenWithProgids。幂等：已指向当前 exe 时跳过。
#[cfg(windows)]
pub fn register_markdown_association() {
    let exe = match env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };
    let exe_str = exe.to_string_lossy().to_string();
    let command = format!("\"{}\" \"%1\"", exe_str);

    let progid_key = format!("HKCU\\Software\\Classes\\{}", PROG_ID);
    let command_key = format!("{}\\shell\\open\\command", progid_key);

    // 已指向当前 exe 则跳过，避免每次启动都写注册表。
    if reg_query_default(&command_key).as_deref() == Some(command.as_str()) {
        return;
    }

    // ProgID 友好名
    reg_set_default(&progid_key, PROG_ID_DESC);
    // 图标：取 exe 内置图标
    reg_set_default(
        &format!("{}\\DefaultIcon", progid_key),
        &format!("\"{}\",0", exe_str),
    );
    // 打开命令
    reg_set_default(&command_key, &command);

    // 登记到各扩展名的 OpenWithProgids，使其出现在「打开方式」列表
    for ext in EXTENSIONS {
        reg_set_none(
            &format!("HKCU\\Software\\Classes\\{}\\OpenWithProgids", ext),
            PROG_ID,
        );
    }
}

/// 非 Windows：文件关联由打包产物声明（deb 的 .desktop 走 `bundle.fileAssociations`
/// 的 `mimeType`），运行时没有注册表可写——空操作。
#[cfg(not(windows))]
pub fn register_markdown_association() {}
