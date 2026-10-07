import httpx
from supabase import ClientOptions, create_client

from app.config import supabase_credentials

# HTTP/1.1 on purpose: the default client multiplexes every request over one
# HTTP/2 connection, which isn't safe across Flask's request threads (concurrent
# requests intermittently fail with RemoteProtocolError: ConnectionTerminated).
supabase = create_client(
    *supabase_credentials(),
    options=ClientOptions(httpx_client=httpx.Client(http2=False)),
)
