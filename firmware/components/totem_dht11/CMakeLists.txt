idf_component_register(SRCS "totem_dht11.c"
                    INCLUDE_DIRS "include"
                    REQUIRES
                        driver
                        esp_timer)
