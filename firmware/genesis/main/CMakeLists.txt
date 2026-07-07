idf_component_register(SRCS "genesis.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        app_update
                        esp_http_client
                        esp_wifi
                        esp_timer
                        driver
                        json
                        mbedtls
                        mqtt
                        nvs_flash)
