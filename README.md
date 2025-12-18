# Bee Map

```bash

# make sure that you are in the main folder of the repo (bee_map)

# install dependencies
npm install

# create a /public/config.json file based on the example.config.json file

# serve the app from a development server
npm run dev

# open http://localhost:5173/bee_map/ with your web browser and connect to the MQTT broker 

# test with mosquitto_pub client
mosquitto_pub -h test.mosquitto.org -p 1883 -t bee_map/20635FF200007E8A -f ul_example.json

# or test with http POST (curl)
# this test requires lainching the backend server (in the backend folder)
curl -X POST http://localhost:4000/ingest -H "Content-Type: application/json" --data-binary @ul_example.json


```
