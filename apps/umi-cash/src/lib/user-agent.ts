/**
 * Lightweight User-Agent parser — no dependencies.
 * Extracts device name and OS from common UA strings.
 */

interface DeviceInfo {
  device: string;
  os: string;
}

export function parseUserAgent(ua: string): DeviceInfo {
  if (!ua) return { device: 'Desconocido', os: 'Desconocido' };

  const os = parseOS(ua);
  const device = parseDevice(ua);

  return { device, os };
}

function parseOS(ua: string): string {
  // iOS
  const ios = ua.match(/(?:iPhone|iPad|iPod) OS (\d+[_\.]\d+)/);
  if (ios) return `iOS ${ios[1].replace('_', '.')}`;

  // Android
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;

  // macOS
  const mac = ua.match(/Mac OS X (\d+[_\.]\d+)/);
  if (mac) return `macOS ${mac[1].replace('_', '.')}`;

  // Windows
  if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
  if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
  if (ua.includes('Windows')) return 'Windows';

  // Linux
  if (ua.includes('Linux')) return 'Linux';

  return 'Otro';
}

function parseDevice(ua: string): string {
  // iPhone
  if (ua.includes('iPhone')) return 'iPhone';

  // iPad
  if (ua.includes('iPad')) return 'iPad';

  // Android device — try to extract model
  const androidDevice = ua.match(/;\s*([^;)]+)\s*Build\//);
  if (androidDevice) {
    const model = androidDevice[1].trim();
    // Clean up common prefixes
    return model.length > 30 ? model.slice(0, 30) : model;
  }

  // Generic Android
  if (ua.includes('Android')) return 'Android';

  // Desktop
  if (ua.includes('Macintosh')) return 'Mac';
  if (ua.includes('Windows')) return 'PC Windows';
  if (ua.includes('Linux') && !ua.includes('Android')) return 'PC Linux';

  return 'Otro';
}
