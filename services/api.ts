export interface ApiError {
  message: string;
  code: string;
  duration?: number;
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    let errorData: ApiError;
    try {
      const data = await response.json();
      errorData = data.error || { message: 'Unknown error', code: 'UNKNOWN' };
    } catch {
      errorData = { 
        message: `HTTP Error ${response.status}: ${response.statusText}`, 
        code: 'HTTP_ERROR' 
      };
    }
    throw new Error(errorData.message);
  }

  return response.json() as Promise<T>;
}
