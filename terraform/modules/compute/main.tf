resource "alicloud_ecs_key_pair" "this" {
  key_pair_name = "${var.project_name}-${var.environment}-key"
  public_key    = var.ssh_public_key
  tags          = { Project = var.project_name, Environment = var.environment }
}

locals {
  livekit_config = templatefile("${path.root}/../../templates/livekit.yaml.tpl", {
    api_key     = var.livekit_api_key
    api_secret  = var.livekit_api_secret
    turn_domain = var.turn_domain
  })
  docker_compose = templatefile("${path.root}/../../templates/docker-compose.yaml.tpl", {
    eip_address = var.eip_address
  })
  caddy_config = templatefile("${path.root}/../../templates/caddy.yaml.tpl", {
    domain      = var.domain
    turn_domain = var.turn_domain
  })
  redis_config = file("${path.root}/../../templates/redis.conf.tpl")
  cloud_init = templatefile("${path.root}/../../templates/cloud-init.yaml.tpl", {
    docker_compose_content = local.docker_compose
    livekit_config_content = local.livekit_config
    caddy_config_content   = local.caddy_config
    redis_config_content   = local.redis_config
  })
}

resource "alicloud_instance" "livekit" {
  instance_name              = "${var.project_name}-${var.environment}-server"
  instance_type              = var.instance_type
  image_id                   = var.image_id
  system_disk_category       = "cloud_essd"
  system_disk_size           = var.system_disk_size
  vswitch_id                 = var.vswitch_id
  security_groups            = [var.sg_id]
  key_name                   = alicloud_ecs_key_pair.this.key_pair_name
  user_data                  = base64encode(local.cloud_init)
  internet_max_bandwidth_out = 0
  tags                       = { Project = var.project_name, Environment = var.environment }
}

resource "alicloud_eip_association" "livekit" {
  allocation_id = var.eip_id
  instance_id   = alicloud_instance.livekit.id
  instance_type = "EcsInstance"
}

resource "null_resource" "provision" {
  depends_on = [alicloud_eip_association.livekit]

  triggers = {
    instance_id = alicloud_instance.livekit.id
  }

  connection {
    type        = "ssh"
    host        = var.eip_address
    user        = "root"
    private_key = file(var.ssh_private_key_path)
    timeout     = "10m"
  }

  provisioner "remote-exec" {
    inline = [
      "echo 'Waiting for cloud-init to complete...'",
      "cloud-init status --wait || timeout 600 bash -c 'while [ ! -f /var/log/livekit-setup.log ] || ! grep -q \"LiveKit setup completed successfully\" /var/log/livekit-setup.log; do echo \"Waiting for setup...\"; sleep 15; done'",
      "echo '--- Setup log ---'",
      "cat /var/log/livekit-setup.log || true",
      "docker ps",
    ]
  }
}
