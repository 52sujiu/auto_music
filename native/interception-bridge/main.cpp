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

struct Api {
  HMODULE dll = nullptr;
  CreateFn create = nullptr;
  DestroyFn destroy = nullptr;
  SendFn send = nullptr;
};

// Keyboard(0)=1, Mouse(0)=11 per interception.h convention.
constexpr Device kKeyboard = 1;
constexpr Device kMouse = 11;
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
  if (!GetModuleFileNameW(nullptr, path, MAX_PATH)) return nullptr;
  std::wstring full(path);
  auto sep = full.find_last_of(L"\\/");
  std::wstring dll = (sep == std::wstring::npos ? L"interception.dll" : full.substr(0, sep + 1) + L"interception.dll");
  return LoadLibraryW(dll.c_str());
}

bool load_api(Api &api) {
  api.dll = load_from_own_dir();
  if (!api.dll) api.dll = LoadLibraryW(L"interception.dll");
  if (!api.dll) return false;
  api.create = reinterpret_cast<CreateFn>(GetProcAddress(api.dll, "interception_create_context"));
  api.destroy = reinterpret_cast<DestroyFn>(GetProcAddress(api.dll, "interception_destroy_context"));
  api.send = reinterpret_cast<SendFn>(GetProcAddress(api.dll, "interception_send"));
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
    error("找不到 interception.dll，请先安装 Interception 驱动并把 x64/interception.dll 放到程序 driver 目录");
    return 1;
  }
  Context ctx = api.create();
  if (!ctx) {
    error("Interception 驱动未就绪，请用管理员运行 Install-interception.exe /install 后重启");
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
      ok = api.send(ctx, kKeyboard, &stroke, 1) > 0;
    } else if (kind == 'M') {
      unsigned short state = 0;
      if (!mouse_state(value, down == 1, state)) {
        error("unsupported mouse button");
        continue;
      }
      MouseStroke stroke{state, 0, 0, 0, 0, 0};
      ok = api.send(ctx, kMouse, &stroke, 1) > 0;
    } else {
      error("unsupported input kind");
      continue;
    }
    if (ok) std::cout << "OK" << std::endl;
    else error("Interception 发送失败，检查驱动是否已安装并重启");
  }
  api.destroy(ctx);
  return 0;
}
