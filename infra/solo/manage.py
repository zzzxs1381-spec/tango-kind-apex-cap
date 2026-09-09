#!/usr/bin/env python3
"""Bounded recovery, honest status, and backups for the one-server deployment."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import time
from probe import probe
from render import write

BASE = Path('/etc/xfreedom-solo')
ROOT = Path('/opt/xfreedom-solo')
DATA = Path('/var/lib/xfreedom-solo')
UNITS = ('xfreedom-xray', 'xfreedom-hysteria')


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=kwargs.pop('timeout', 60), **kwargs)


def compose(*args, **kwargs):
    return run(['docker', 'compose', '--env-file', str(BASE / 'compose.env'),
        '-f', str(ROOT / 'current/infra/solo/compose.yaml'), *args], **kwargs)


def service_active(name):
    return subprocess.run(['systemctl', 'is-active', '--quiet', name], timeout=10).returncode == 0


def container_status():
    result = {}
    for name in ('postgres', 'qdrant', 'app'):
        ids = compose('ps', '-aq', name, capture_output=True, text=True).stdout.split()
        if not ids:
            result[name] = 'missing'
            continue
        obj = json.loads(run(['docker', 'inspect', ids[0]], capture_output=True, text=True).stdout)[0]
        state = obj['State']
        result[name] = state.get('Health', {}).get('Status', state['Status']) if state['Running'] else state['Status']
    return result


def api_checks():
    app = subprocess.run(['curl', '-fsS', '--max-time', '6',
        'http://127.0.0.1:8080/api/health'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    pg = compose('exec', '-T', 'postgres', 'psql', '-U', 'xfreedom', '-d', 'xfreedom',
        '-Atc', 'SELECT 1', capture_output=True, text=True).stdout.strip() == '1'
    # Keep the API key in the container environment; never in command arguments.
    script = "fetch('http://qdrant:6333/collections',{headers:{'api-key':process.env.QDRANT_API_KEY},signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    try:
        compose('exec', '-T', 'app', 'node', '-e', script, capture_output=True)
        qdrant = True
    except subprocess.CalledProcessError:
        qdrant = False
    return {'app': app, 'postgres': pg, 'qdrant': qdrant}


def status(with_probe=False):
    result = {'checked_at': int(time.time()), 'services': {u: service_active(u) for u in UNITS},
              'containers': container_status()}
    result['watchdog'] = service_active('xfreedom-solo-repair.timer')
    try:
        result['checks'] = api_checks()
    except (subprocess.SubprocessError, OSError):
        result['checks'] = {'app': False, 'postgres': False, 'qdrant': False}
    previous = DATA / 'status/status.json'
    if with_probe:
        result['transports'] = probe(BASE, ROOT / 'current/bin')
    elif previous.exists():
        result['transports'] = json.loads(previous.read_text()).get('transports')
    result['automatic_recovery'] = 'bounded restarts; no self-editing or automatic upgrades'
    write(previous, result, 0o644)
    return result


def repair():
    """Only our own units/containers; maximum one attempt per 10 minutes."""
    cooldown = DATA / 'last-repair'
    services = [u for u in UNITS if not service_active(u)]
    containers = container_status()
    bad = [name for name, health in containers.items() if health in ('missing', 'exited', 'dead', 'unhealthy')]
    if (services or bad) and (not cooldown.exists() or time.time() - cooldown.stat().st_mtime > 600):
        cooldown.touch()
        for unit in services:
            run(['systemctl', 'restart', unit])
        for name in bad:
            if containers[name] == 'unhealthy':
                compose('restart', name, timeout=90)
            else:
                compose('up', '-d', '--no-build', '--no-deps', name, timeout=90)
    # A regional block or upstream outage is not a reason to restart healthy services.
    return status()


def backup():
    destination = DATA / 'backups' / time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    destination.mkdir(parents=True, mode=0o700)
    # Consistent logical DB backup, rather than copying live PostgreSQL files.
    with (destination / 'postgres.dump').open('wb') as stream:
        compose('exec', '-T', 'postgres', 'pg_dump', '-U', 'xfreedom', '-d', 'xfreedom', '-Fc', stdout=stream, timeout=600)
    # A Qdrant full storage snapshot remains within its durable snapshot volume.
    script = "fetch('http://qdrant:6333/snapshots',{method:'POST',headers:{'api-key':process.env.QDRANT_API_KEY},signal:AbortSignal.timeout(120000)}).then(async r=>{if(!r.ok)throw Error('snapshot failed');console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"
    result = compose('exec', '-T', 'app', 'node', '-e', script, capture_output=True, text=True, timeout=150)
    snapshot = json.loads(result.stdout)['result']['name']
    if Path(snapshot).name != snapshot:
        raise ValueError('Unexpected snapshot path')
    compose('cp', 'qdrant:/qdrant/snapshots/' + snapshot, str(destination / 'qdrant.snapshot'), timeout=300)
    # Remove only the just-exported server snapshot to avoid unbounded duplicate growth.
    delete = "fetch('http://qdrant:6333/snapshots/'+encodeURIComponent(process.argv[1]),{method:'DELETE',headers:{'api-key':process.env.QDRANT_API_KEY}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    compose('exec', '-T', 'app', 'node', '-e', delete, snapshot, capture_output=True)
    with tarfile.open(destination / 'configuration.tar.gz', 'w:gz') as archive:
        archive.add(BASE, arcname='xfreedom-solo')
    (destination / 'COMPLETE').write_text('Backup complete. Contains private credentials.\n')
    # Retention: prune only our own complete backup directories, keeping seven.
    complete = sorted((DATA / 'backups').glob('*/COMPLETE'))
    for marker in complete[:-7]:
        import shutil
        shutil.rmtree(marker.parent)
    return {'backup': str(destination), 'offsite_copy': False}


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Use sudo xfreedom-solo <status|probe|repair|backup|links|logs>')
    os.umask(0o077)
    DATA.mkdir(parents=True, exist_ok=True)
    with open(DATA / 'operation.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another XFreedom operation is running; retry later')
        command = sys.argv[1] if len(sys.argv) > 1 else 'status'
        if command == 'links':
            print((BASE / 'clients/client-links.txt').read_text(), end='')
        elif command == 'logs':
            run(['journalctl', '--no-pager', '-n', '80', '-u', UNITS[0], '-u', UNITS[1]])
            compose('logs', '--tail=50')
        else:
            action = {'status': status, 'probe': lambda: status(True), 'repair': repair, 'backup': backup}.get(command)
            if action is None:
                raise SystemExit('Unknown command')
            result = action()
            print(json.dumps(result, indent=2, ensure_ascii=False))
            if command in ('status', 'probe'):
                ok = all(result['services'].values()) and all(result['checks'].values())
                if command == 'probe':
                    ok = ok and all(result['transports'][p][k] for p in ('xray', 'hysteria') for k in ('tcp', 'udp_dns'))
                raise SystemExit(0 if ok else 1)
