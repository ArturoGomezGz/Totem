# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

# Forzar version.txt como fuente de la versión — ver nota en
# firmware/simulator/CMakeLists.txt sobre por qué es necesario.
set(PROJECT_VER_FILE "${CMAKE_CURRENT_LIST_DIR}/version.txt")

# Componentes compartidos entre proyectos de firmware — ver
# firmware/NON-NEGOTIABLES.md sección 10. genesis usa totem_core (WiFi/NVS/
# OTA/rollback) y totem_dht11 (sensor real, no lo necesitan bootstrap ni
# simulator).
set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/../components")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(genesis)
