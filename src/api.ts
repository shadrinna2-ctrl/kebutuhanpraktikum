export class ApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = typeof data?.code === 'string' ? data.code : undefined;
    this.data = data;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'PinjamAlat',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { error: 'Respons server tidak valid.' };
    }
  }

  if (!res.ok) {
    throw new ApiError(
      typeof json.error === 'string' ? json.error : 'Permintaan gagal diproses.',
      res.status,
      json
    );
  }

  return json as T;
}

export function formatRupiah(value: number): string {
  return 'Rp' + Number(value || 0).toLocaleString('id-ID');
}
