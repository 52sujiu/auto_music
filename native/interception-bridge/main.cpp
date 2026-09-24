//! Send-only bridge for oblitum/Interception (free, signed driver).
//! Loads interception.dll at runtime, so build needs no SDK.
#include <windows.h>

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {
using Context = void *;
using Device = int;
using Predicate = int (*)(Device);
using CreateFn = Context (*)();
using DestroyFn = void (*)(Context);
using SetFilterFn = void (*)(Context, Predicate, unsigned short);
using SendFn = int (*)(Context, Device, const void *, unsigned int);
using GetHwIdFn = unsigned int (*)(Context, Device, void *, unsigned int);

struct Api {
  HMODULE dll = nullptr;
  CreateFn create = nullptr;
  DestroyFn destroy = nullptr;
  SendFn send = nullptr;
  GetHwIdFn get_hwid = nullptr;  // optional, for device enumeration
};

// Device convention per interception.h: keyboards 1..10, mice 11..20.
// Never hardcode 1/11: laptops/RDP may expose different slots, so enumerate.
constexpr Device kKeyboardBase = 1;
constexpr Device kMouseBase = 11;
constexpr int kMaxEach = 10;

bool device_exists(Api &api, Context ctx, Device dev) {
  if (!api.get_hwid) return true;  // old dll, assume present
  wchar_t buf[256];
  return api.get_hwid(ctx, dev, buf, sizeof(buf)) > 0;
}

bool find_devices(Api &api, Context ctx, Device &keyboard, Device &mouse) {
  keyboard = 0;
  mouse = 0;
  for (int i = 0; i < kMaxEach; ++i) {
    if (!keyboard && device_exists(api, ctx, kKeyboardBase + i)) keyboard = kKeyboardBase + i;
    if (!mouse && device_exists(api, ctx, kMouseBase + i)) mouse = kMouseBase + i;
    if (keyboard && mouse) break;
  }
  if (!api.get_hwid) {
    keyboard = kKeyboardBase;
    mouse = kMouseBase;
  }
  return keyboard != 0 && mouse != 0;
}
constexpr unsigned short kKeyDown = 0x00;
constexpr unsigned short kKeyUp = 0x01;
constexpr unsigned short kMouseLeftDown = 0x001;
constexpr unsigned short kMouseLeftUp = 0x002;
constexpr unsigned short kMouseRightDown = 0x004;
constexpr unsigned short kMouseRightUp = 0x008;
constexpr unsigned short kMouseMiddleDown = 0x010;
constexpr unsigned short kMouseMiddleUp = 0x020;

#pragma pack(push, 1)
struct KeyStroke {
  unsigned short code;
  unsigned short state;
  unsigned int information;
};
struct MouseStroke {
  unsigned short state;
  unsigned short flags;
  short rolling;
  int x;
  int y;
  unsigned int information;
};
#pragma pack(pop)

void error(const std::string &message) { std::cout << "ERR " << message << std::endl; }

HMODULE load_from_own_dir() {
  wchar_t path[MAX_PATH];
  if (GetModuleFileNameW(nullptr, path, MAX_PATH)) {
    std::wstring full(path);
    auto sep = full.find_last_of(L"\\/");
    std::wstring dll = (sep == std::wstring::npos ? L"interception.dll" : full.substr(0, sep + 1) + L"interception.dll");
    if (HMODULE h = LoadLibraryW(dll.c_str())) return h;
  }
  // User-mode auto-install locations, no admin needed for the DLL itself.
  const wchar_t *cands[] = {
      L"\\auto-music-interception\\dll\\interception.dll",
      L"\\auto-music-interception\\Interception\\Interception\\library\\x64\\interception.dll",
      L"\\auto-music-interception\\Interception\\library\\x64\\interception.dll",
  };
  wchar_t temp[MAX_PATH];
  const wchar_t *envs[] = {L"TEMP", L"TMP"};
  for (const wchar_t *env : envs) {
    if (!GetEnvironmentVariableW(env, temp, MAX_PATH)) continue;
    for (const wchar_t *rel : cands) {
      std::wstring dll = std::wstring(temp) + rel;
      if (HMODULE h = LoadLibraryW(dll.c_str())) return h;
    }
  }
  return nullptr;
}

bool load_api(Api &api) {
  api.dll = load_from_own_dir();
  if (!api.dll) api.dll = LoadLibraryW(L"interception.dll");
  if (!api.dll) return false;
  api.create = reinterpret_cast<CreateFn>(GetProcAddress(api.dll, "interception_create_context"));
  api.destroy = reinterpret_cast<DestroyFn>(GetProcAddress(api.dll, "interception_destroy_context"));
  api.send = reinterpret_cast<SendFn>(GetProcAddress(api.dll, "interception_send"));
  api.get_hwid =
      reinterpret_cast<GetHwIdFn>(GetProcAddress(api.dll, "interception_get_hardware_id"));
  return api.create && api.destroy && api.send;
}

bool scan_code(char key, unsigned short &code) {
  switch (key) {
    case 'z': code = 0x2c; return true;
    case 'x': code = 0x2d; return true;
    case 'c': code = 0x2e; return true;
    case 'v': code = 0x2f; return true;
    case 'b': code = 0x30; return true;
    case 'n': code = 0x31; return true;
    case 'm': code = 0x32; return true;
    case ',': code = 0x33; return true;
    default: return false;
  }
}

bool mouse_state(char button, bool down, unsigned short &state) {
  switch (button) {
    case 'L': state = down ? kMouseLeftDown : kMouseLeftUp; return true;
    case 'R': state = down ? kMouseRightDown : kMouseRightUp; return true;
    case 'M': state = down ? kMouseMiddleDown : kMouseMiddleUp; return true;
    default: return false;
  }
}
}  // namespace

int main(int argc, char **argv) {
  if (argc != 2 || (std::string(argv[1]) != "--probe" && std::string(argv[1]) != "--play")) {
    error("invalid mode");
    return 2;
  }
  Api api;
  if (!load_api(api)) {
    error("找不到 interception.dll，点“一键安装驱动”自动下载安装，装完重启再检查");
    return 1;
  }
  Context ctx = api.create();
  if (!ctx) {
    error("Interception 驱动未就绪，请用管理员运行 Install-interception.exe /install 后重启");
    return 1;
  }
  Device keyboard = 0, mouse = 0;
  if (!find_devices(api, ctx, keyboard, mouse)) {
    std::string what;
    if (!keyboard && !mouse) what = "键盘和鼠标";
    else if (!keyboard) what = "键盘";
    else what = "鼠标";
    error("本机没有可用的 Interception " + what + "设备(触控板/远控会话可能无鼠标栈)，键盘可用时切系统模拟输入");
    api.destroy(ctx);
    return 1;
  }
  std::cout << "READY" << std::endl;
  if (std::string(argv[1]) == "--probe") {
    api.destroy(ctx);
    return 0;
  }
  std::string line;
  while (std::getline(std::cin, line)) {
    char kind = 0, value = 0;
    int down = -1;
    std::istringstream input(line);
    if (!(input >> kind >> value >> down) || (down != 0 && down != 1)) {
      error("invalid input command");
      continue;
    }
    bool ok = false;
    if (kind == 'K') {
      unsigned short code = 0;
      if (!scan_code(value, code)) {
        error("unsupported key");
        continue;
      }
      KeyStroke stroke{code, static_cast<unsigned short>(down ? kKeyDown : kKeyUp), 0};
      ok = api.send(ctx, keyboard, &stroke, 1) > 0;
    } else if (kind == 'M') {
      unsigned short state = 0;
      if (!mouse_state(value, down == 1, state)) {
        error("unsupported mouse button");
        continue;
      }
      MouseStroke stroke{state, 0, 0, 0, 0, 0};
      ok = api.send(ctx, mouse, &stroke, 1) > 0;
    } else {
      error("unsupported input kind");
      continue;
    }
    if (ok) {
      std::cout << "OK" << std::endl;
    } else {
      DWORD code = GetLastError();
      error("Interception 发送失败(本机错误码 " + std::to_string(code) + ")，刚安装请重启后再试");
    }
  }
  api.destroy(ctx);
  return 0;
}
