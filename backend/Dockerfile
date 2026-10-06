# ejaBashkohu backend (Django + Channels). Built and run by ../deploy/docker-compose.yml.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --uid 1000 app && mkdir -p /data/storage && chown -R app /data /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# migrations are run by hand (deploy/switch.sh), never automatically at start
CMD ["python", "manage.py", "serve", "--host", "0.0.0.0", "--port", "8000"]
