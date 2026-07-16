idf_component_register(SRCS "monitorio.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        totem_core
                        driver
                        esp_adc
                        esp_timer
                        json
                        mqtt
                        nvs_flash)
