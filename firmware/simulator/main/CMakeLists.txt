idf_component_register(SRCS "simulator.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        app_update
                        esp_http_client
                        esp_wifi
                        json
                        mbedtls
                        mqtt
                        nvs_flash)
