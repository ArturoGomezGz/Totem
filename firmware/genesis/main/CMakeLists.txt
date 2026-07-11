idf_component_register(SRCS "genesis.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        totem_core
                        totem_dht11
                        driver
                        esp_adc
                        esp_timer
                        json
                        mqtt
                        nvs_flash)
