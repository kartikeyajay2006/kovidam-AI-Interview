import os
import smtplib
from dotenv import load_dotenv

load_dotenv("backend/.env")

host = os.getenv("SMTP_HOST")
port = int(os.getenv("SMTP_PORT", 587))
user = os.getenv("SMTP_USERNAME")
pwd = os.getenv("SMTP_PASSWORD")

try:
    print(f"Connecting to {host}:{port}...")
    with smtplib.SMTP(host, port, timeout=10) as server:
        server.set_debuglevel(1)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(user, pwd)
        print("Login successful!")
except Exception as e:
    print(f"Error: {e}")
