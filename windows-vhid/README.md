# Windows 虚拟 HID 原型

这个目录提供一份 KMDF/VHF 源驱动。Windows 版 Auto Music 默认选「虚拟 HID」，播放端把谱面事件编码成键盘和鼠标 HID 输入报告，写入 `\\.\AutoMusicVhid`；驱动再调用 `VhfReadReportSubmit`。鼠标可用普通鼠标，原有物理键鼠无需替换。

桌面程序的“检查更新”只更新程序本体。程序内提供“选择并安装驱动包”入口：选中已签名包中的 `AutoMusicVhid.inf` 后，程序会请求一次 Windows 管理员授权，创建根设备并安装驱动。如果构建前把完整的已签名 `AutoMusicVhid.inf/.sys/.cat` 放入 `src-tauri/driver/`，安装包会附带该驱动，界面显示“一键安装驱动”。当前仓库尚无已签名驱动包，因此发布的安装包不能直接完成驱动安装。

它创建的是 **Windows 内部的虚拟 HID 设备**，不会在 USB 总线上生成物理 USB 电气信号，也不会伪装成现有鼠标的硬件报文。目标程序是否接受，以及它如何判定输入，必须在 Windows 上实际测试。

## 构建

1. 在 Windows x64 上安装 Visual Studio 的 C++ 工作负载、版本匹配的 Windows SDK 和 WDK，并安装 Rust、Node.js。WDK 安装方法见[微软文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/download-the-wdk)。
2. 用 Visual Studio 打开 `driver/AutoMusicVhid.vcxproj`，选择 `Debug|x64`，构建驱动。WDK 应同时生成 `.sys`、`.inf` 和驱动包；若 INF 验证或签名步骤报错，以 Windows 上的 WDK 输出为准修正。这里尚未在 Windows 上编译。
3. 用微软支持的发布签名流程签名驱动包；未签名的 WDK 构建产物不能在普通 Windows 上加载。将签名后的 INF、SYS、CAT 放入 `src-tauri/driver/`，再构建桌面程序。

## 在测试机安装与检查

内核驱动必须满足 Windows 驱动签名要求。先按[微软测试签名流程](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/test-signing)准备隔离的测试机和驱动包；不要在日常游戏系统上为了测试而关闭系统安全功能。

可在应用内点击安装；程序会通过 Windows UAC 请求管理员权限，使用 SetupAPI 创建根设备，并调用 `UpdateDriverForPlugAndPlayDevicesW` 安装驱动。若需要手动排查，可用 **管理员命令提示符**进入已签名驱动包所在目录，使用 WDK 随附的 DevCon 创建根设备并安装：

```cmd
devcon install AutoMusicVhid.inf Root\AutoMusicVhid
```

仅运行 `pnputil /add-driver ... /install` 不一定会创建新的 `Root\AutoMusicVhid` 设备节点。DevCon 的根设备安装方式见[微软 KMDF 教程](https://learn.microsoft.com/en-us/windows-hardware/drivers/gettingstarted/writing-a-kmdf-driver-based-on-a-template)。

安装后在设备管理器中确认 `Auto Music Virtual HID Source` 及其虚拟键盘、鼠标设备无错误，再启动桌面程序。在记事本等普通窗口用简单谱面测试按键，检查 F8 停止后按键与鼠标按钮均能释放。若程序显示“无法打开虚拟 HID 驱动”，先检查驱动是否加载、签名和设备路径是否存在。若播放正常但目标程序不响应，记录 Windows 版本、设备管理器状态、具体错误和最短复现步骤。

## 数据约定

| 报告 ID | 长度 | 布局 |
| --- | ---: | --- |
| 1 | 9 字节 | ID、修饰键、保留、6 个 HID 键码 |
| 2 | 5 字节 | ID、三键位图、相对 X、相对 Y、滚轮 |

驱动只接受音键 `Z X C V B N M ,` 和鼠标左、右、中键；移动量恒为零。文件句柄关闭时，驱动提交全松开报告。报告定义在 `driver/AutoMusicVhid.c`，对应的 Rust 编码在 `src-tauri/src/playback/vhid.rs`。

参考：[微软 VHF 设计与驱动流程](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/virtual-hid-framework--vhf-)、[微软 HIDInjector 示例](https://github.com/microsoft/Windows-IoT-Samples/tree/master/samples/HIDInjector/driver)。
