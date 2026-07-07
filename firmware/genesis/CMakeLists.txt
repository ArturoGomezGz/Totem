# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

# Forzar version.txt como fuente de la versión — ver nota en
# firmware/simulator/CMakeLists.txt sobre por qué es necesario.
set(PROJECT_VER_FILE "${CMAKE_CURRENT_LIST_DIR}/version.txt")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(genesis)
