port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  enable_loopback_candidate: false
redis:
  address: localhost:6379
keys:
  ${api_key}: ${api_secret}
logging:
  level: info
turn:
  enabled: true
  domain: ${turn_domain}
  tls_port: 5349
  udp_port: 3478
  external_tls: true
