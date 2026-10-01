# The bge-m3 embedder of NewsGenerator on a machine without an NVIDIA card: PyTorch for the processor only
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "FlagEmbedding>=1.3"
COPY server.py .
ENV EMBEDDER_HOST=0.0.0.0 HF_HOME=/cache
EXPOSE 8020
CMD ["python", "-u", "server.py"]
