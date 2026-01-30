docker build -t mining-map .
docker run -p 5173:5173 -p 8000:8000 -it mining-map
