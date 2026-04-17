logging:
  logs:
    default:
      level: INFO
apps:
  tls:
    certificates:
      automate:
        - ${domain}
        - ${turn_domain}
  layer4:
    servers:
      main:
        listen:
          - ":443"
        routes:
          - match:
              - tls:
                  sni:
                    - "${turn_domain}"
            handle:
              - handler: tls
              - handler: proxy
                upstreams:
                  - dial:
                      - "127.0.0.1:5349"
          - match:
              - tls:
                  sni:
                    - "${domain}"
            handle:
              - handler: tls
              - handler: proxy
                upstreams:
                  - dial:
                      - "127.0.0.1:7880"
