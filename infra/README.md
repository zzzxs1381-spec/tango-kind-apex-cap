> **Russia/RKN deployments:** the older plain-WireGuard mesh documented below is retained as a generic baseline only. For RU-connected production use, prefer [infra/rkn](./rkn/README.md), which replaces the mesh with AmneziaWG and adds REALITY/Hysteria2 transport diversity.

# XFreedom three-node VPS cluster

Roles:
- **edge**: public Nginx entrypoint, only ports 80/443 and WireGuard are intended to be public.
- **primary**: application + PostgreSQL + Qdrant.
- **secondary**: warm application replica using the primary databases through WireGuard.

Private mesh:
- edge: `10.77.0.1/24`
- primary: `10.77.0.2/24`
- secondary: `10.77.0.3/24`
- UDP 51820 between peers.

## Bootstrap
Run `infra/bootstrap-node.sh` once per VPS. It installs Docker/WireGuard, enables forwarding, generates a local WireGuard keypair and prints only the public key.

Create `/etc/xfreedom/mesh.env` from `infra/mesh.env.example` using the other two nodes' public keys and endpoints, then run:
```bash
sudo infra/render-wireguard.sh
```

## Application env
Create `/opt/xfreedom/app/.env` from `infra/app.env.example`. Keep all real secrets only on the VPS.

## Deploy
```bash
sudo infra/deploy-role.sh edge
sudo infra/deploy-role.sh primary
sudo infra/deploy-role.sh secondary
```

The watchdog timer runs every minute, recreates missing Compose services, restarts unhealthy containers, and restores the WireGuard interface if it disappears.

## Security after key-based access works
Do not disable password SSH until an SSH public key is confirmed to work. After that, rotate the temporary root passwords and disable password authentication.
