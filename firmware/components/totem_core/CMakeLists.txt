idf_component_register(SRCS
                        "totem_config.c"
                        "totem_wifi.c"
                        "totem_ota.c"
                        "totem_rollback.c"
                        "totem_status.c"
                        "totem_led.c"
                    INCLUDE_DIRS "include"
                    REQUIRES
                        app_update
                        esp_http_client
                        esp_timer
                        esp_wifi
                        json
                        mbedtls
                        mqtt
                        nvs_flash
                        led_strip)
