import { useApp } from "./session";

type IpWho = {
  ip?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  success?: boolean;
};

function readTelegram() {
  const w = window as unknown as {
    Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } } } };
  };
  const u = w.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!u) return;
  useApp.getState().setPerson({
    tgId: u.id,
    name: u.first_name,
    username: u.username,
  });
}

async function ipFix(): Promise<IpWho | null> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 2400);
    const res = await fetch("https://ipwho.is/", { signal: ctrl.signal });
    window.clearTimeout(t);
    const body = (await res.json()) as IpWho;
    if (body.success === false) return null;
    return body;
  } catch {
    return null;
  }
}

function gpsFix(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(null), 2400);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(t);
        resolve(p);
      },
      () => {
        window.clearTimeout(t);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 2200, maximumAge: 60_000 },
    );
  });
}

export async function locateQuiet() {
  readTelegram();
  const [ip, gps] = await Promise.all([ipFix(), gpsFix()]);
  const cur = useApp.getState().person;
  useApp.getState().setPerson({
    ip: ip?.ip ?? cur.ip,
    city: ip?.city || cur.city,
    country: ip?.country || cur.country,
    lat: gps?.coords.latitude ?? ip?.latitude ?? cur.lat,
    lng: gps?.coords.longitude ?? ip?.longitude ?? cur.lng,
  });
}
