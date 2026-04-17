bind 127.0.0.1
port 6379
maxmemory 256mb
maxmemory-policy allkeys-lru
save 60 1000
appendonly yes
protected-mode yes
