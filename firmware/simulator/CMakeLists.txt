# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

# Forzar version.txt como fuente de la versión — sin esto, ESP-IDF prioriza
# `git describe` sobre version.txt cuando el proyecto vive dentro de un repo
# git (este vive dentro del repo Totem), lo que produce versiones como
# "d528eab-dirty" en vez de la versión real declarada en version.txt.
set(PROJECT_VER_FILE "${CMAKE_CURRENT_LIST_DIR}/version.txt")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(simulator)
