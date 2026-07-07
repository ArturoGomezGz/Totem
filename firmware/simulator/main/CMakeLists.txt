idf_component_register(SRCS "simulator.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        totem_core
                        json
                        mqtt
                        nvs_flash)
