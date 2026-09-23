cmake_minimum_required(VERSION 3.24)
project(auto_music_lvh_bridge LANGUAGES CXX)

include(FetchContent)
set(BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LIBVIRTUALHID_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LIBVIRTUALHID_BUILD_WINDOWS_DRIVER OFF CACHE BOOL "" FORCE)
set(LIBVIRTUALHID_BUILD_WINDOWS_BROKER OFF CACHE BOOL "" FORCE)
set(LIBVIRTUALHID_INSTALL OFF CACHE BOOL "" FORCE)
set(LIBVIRTUALHID_ENABLE_PACKAGING OFF CACHE BOOL "" FORCE)

# Match the official driver installer linked from the application.
FetchContent_Declare(libvirtualhid
  GIT_REPOSITORY https://github.com/LizardByte/libvirtualhid.git
  GIT_TAG v2026.914.1218.10
  GIT_SHALLOW TRUE
  GIT_SUBMODULES third-party/lizardbyte-common)
FetchContent_MakeAvailable(libvirtualhid)

add_executable(auto-music-lvh-bridge main.cpp)
target_link_libraries(auto-music-lvh-bridge PRIVATE libvirtualhid::libvirtualhid)
target_compile_features(auto-music-lvh-bridge PRIVATE cxx_std_23)
if(MSVC)
  set_property(TARGET libvirtualhid PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  set_property(TARGET auto-music-lvh-bridge PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
