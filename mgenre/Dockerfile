# mGENRE (entity linking) of NewsGenerator on a machine without an NVIDIA card: PyTorch for the processor.
# Built and started apart, as the tagger (see mgenre/server.py for the options):
#   docker build -t newsgenerator-mgenre:cpu .
#   docker run -d --name newsgenerator-mgenre --restart unless-stopped --cpus 4 --cpu-shares 128 --memory 5g \
#     -p <address>:8022:8022 --env-file token.env -e MGENRE_THREADS=4 -e MGENRE_MODES=fp32 \
#     -v "$PWD/cache:/cache" newsgenerator-mgenre:cpu
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir "torch>=2.2,<2.10" --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt
COPY *.py .
ENV MGENRE_HOST=0.0.0.0 HF_HOME=/cache
EXPOSE 8022
CMD ["python", "-u", "server.py"]
