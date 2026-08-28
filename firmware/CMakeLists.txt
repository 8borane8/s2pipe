cmake_minimum_required(VERSION 3.17)

set(PICO_BOARD pico CACHE STRING "Pico board (pico, pico_w, pico2, pico2_w)")

include(${CMAKE_CURRENT_LIST_DIR}/pico_sdk_import.cmake)

project(s2pipe_pico C CXX ASM)
set(CMAKE_C_STANDARD 11)

pico_sdk_init()

add_executable(s2pipe_pico
	main.c
	packet.c
	usb_descriptors.c
	wake_ble.c
)

target_include_directories(s2pipe_pico PRIVATE ${CMAKE_CURRENT_LIST_DIR})

target_link_libraries(s2pipe_pico
	pico_stdlib
	tinyusb_device
	tinyusb_board
	hardware_uart
	hardware_irq
)

if (PICO_CYW43_SUPPORTED)
	target_link_libraries(s2pipe_pico
		pico_btstack_ble
		pico_btstack_cyw43
		pico_cyw43_arch_none
	)
	target_compile_definitions(s2pipe_pico PRIVATE CYW43_ENABLE_BLUETOOTH=1)
endif()

pico_enable_stdio_usb(s2pipe_pico 0)
pico_enable_stdio_uart(s2pipe_pico 0)
pico_add_extra_outputs(s2pipe_pico)

pico_set_program_name(s2pipe_pico "s2pipe")
pico_set_program_description(s2pipe_pico "s2pipe 4x HORI Pokken")
