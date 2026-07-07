idf_component_register(SRCS "genesis.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        totem_core
                        totem_dht11
                        driver
                        json
                        mqtt
                        nvs_flash)
