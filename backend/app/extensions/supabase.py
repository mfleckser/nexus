from supabase import create_client

from app.config import supabase_credentials

supabase = create_client(*supabase_credentials())
