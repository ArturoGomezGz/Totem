idf_component_register(SRCS "genesis.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        totem_core
                        totem_dht11
                        driver
                        esp_adc
                        json
                        mqtt
                        nvs_flash)
