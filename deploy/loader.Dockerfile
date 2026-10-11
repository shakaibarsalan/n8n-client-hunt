# The reference-data loader, in a box.
#
# This reads tens of gigabytes of remote parquet and holds a city's worth of
# rows in memory. Running that directly on a small shared host would be
# reckless - few cores, perhaps no swap, and other services (n8n at least)
# running alongside. An unbounded DuckDB scan there does not fail by being
# slow, it fails by getting something else OOM-killed.
#
# In a container it can be capped with --memory and --cpus, and when it is
# finished nothing is left behind on the host - no pip installs, no venv, no
# system packages.
#
#   docker build -f loader.Dockerfile -t clienthunt-loader .
#   docker run --rm --network clienthunt_default --memory 2g --cpus 1.0 ...

FROM python:3.11-slim

# duckdb pulls the parquet, psycopg2 writes the rows. Nothing else is needed,
# and pinning keeps a re-run months from now reproducible.
RUN pip install --no-cache-dir duckdb==1.1.3 psycopg2-binary==2.9.10

# DuckDB downloads its httpfs and spatial extensions on first use. Baking them
# in means the run does not depend on the extension repository being up, and
# does not re-fetch them on every invocation.
RUN python -c "import duckdb; c=duckdb.connect(); c.execute('INSTALL httpfs; INSTALL spatial;')"

WORKDIR /work
COPY load_reference_data.py /work/

ENTRYPOINT ["python", "/work/load_reference_data.py"]
