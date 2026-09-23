#include <libvirtualhid/libvirtualhid.hpp>

#include <iostream>
#include <sstream>
#include <string>

namespace {

void error(const std::string &message) {
  std::cout << "ERR " << message << std::endl;
}

lvh::OperationStatus send_key(lvh::Keyboard &keyboard, char key, bool down) {
  // Use physical US-layout scan codes, matching Auto Music's former HID report.
  std::uint16_t scan_code = 0;
  std::uint16_t virtual_key = 0;
  switch (key) {
    case 'z': scan_code = 0x2c; virtual_key = 0x5a; break;
    case 'x': scan_code = 0x2d; virtual_key = 0x58; break;
    case 'c': scan_code = 0x2e; virtual_key = 0x43; break;
    case 'v': scan_code = 0x2f; virtual_key = 0x56; break;
    case 'b': scan_code = 0x30; virtual_key = 0x42; break;
    case 'n': scan_code = 0x31; virtual_key = 0x4e; break;
    case 'm': scan_code = 0x32; virtual_key = 0x4d; break;
    case ',': scan_code = 0x33; virtual_key = 0xbc; break;
    default: return lvh::OperationStatus::failure(lvh::ErrorCode::invalid_argument, "unsupported key");
  }
  lvh::KeyboardEvent event;
  event.key_code = virtual_key;
  event.scan_code = scan_code;
  event.pressed = down;
  return keyboard.submit(event);
}

lvh::OperationStatus send_mouse(lvh::Mouse &mouse, char button, bool down) {
  switch (button) {
    case 'L': return mouse.button(lvh::MouseButton::left, down);
    case 'R': return mouse.button(lvh::MouseButton::right, down);
    case 'M': return mouse.button(lvh::MouseButton::middle, down);
    default: return lvh::OperationStatus::failure(lvh::ErrorCode::invalid_argument, "unsupported mouse button");
  }
}

}  // namespace

int main(int argc, char **argv) {
  if (argc != 2 || (std::string(argv[1]) != "--probe" && std::string(argv[1]) != "--play")) {
    error("invalid mode");
    return 2;
  }

  lvh::RuntimeOptions options;
  options.backend = lvh::BackendKind::platform_default;
  auto runtime = lvh::Runtime::create(options);
  auto keyboard = runtime->create_keyboard();
  if (!keyboard) {
    error("keyboard: " + keyboard.status.message());
    return 1;
  }
  auto mouse = runtime->create_mouse();
  if (!mouse) {
    error("mouse: " + mouse.status.message());
    return 1;
  }

  // libvirtualhid can fall back to SendInput. Require both real HID nodes.
  if (keyboard.keyboard->device_nodes().empty() || mouse.mouse->device_nodes().empty()) {
    error("请安装并激活 libvirtualhid 驱动；当前输入会回退到系统模拟输入");
    return 1;
  }
  std::cout << "READY" << std::endl;
  if (std::string(argv[1]) == "--probe") return 0;

  std::string line;
  while (std::getline(std::cin, line)) {
    char kind = 0, value = 0;
    int down = -1;
    std::istringstream input(line);
    if (!(input >> kind >> value >> down) || (down != 0 && down != 1)) {
      error("invalid input command");
      continue;
    }
    lvh::OperationStatus status = kind == 'K'
      ? send_key(*keyboard.keyboard, value, down == 1)
      : kind == 'M'
        ? send_mouse(*mouse.mouse, value, down == 1)
        : lvh::OperationStatus::failure(lvh::ErrorCode::invalid_argument, "unsupported input kind");
    if (status.ok()) std::cout << "OK" << std::endl;
    else error(status.message());
  }
  return 0;
}
