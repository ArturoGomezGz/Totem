idf_component_register(SRCS "bootstrap.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        totem_core
                        mqtt
                        nvs_flash)
