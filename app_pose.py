from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import os, io, cv2, base64, json, time, logging
import numpy as np
from ultralytics import YOLO
import torch

# Config
MODEL_PATH = os.getenv("MODEL_PATH", "modelo/yolov8n-pose.pt")
CONF = float(os.getenv("CONF", 0.5))
IMGSZ = int(os.getenv("IMGSZ", 320))
MAX_DIM = int(os.getenv("MAX_DIM", 640))
TRACK = int(os.getenv("TRACK", 1))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("pose-avatar")

# Threads CPU
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
torch.set_num_threads(2)

app = FastAPI(title="Pose Avatar Web", version="0.1.0")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load model
log.info(f"Cargando modelo {MODEL_PATH} imgsz={IMGSZ} conf={CONF}")
model = YOLO(MODEL_PATH)

@app.get("/", response_class=HTMLResponse)
async def index():
    return open("static/index.html", encoding="utf-8").read()

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    log.info("WebSocket conectado")
    try:
        while True:
            data = await ws.receive_text()
            payload = json.loads(data)
            if payload.get("type") != "frame": continue
            b64 = payload.get("image", "").split(",", 1)[-1]
            img = np.frombuffer(base64.b64decode(b64), np.uint8)
            frame = cv2.imdecode(img, cv2.IMREAD_COLOR)
            if frame is None: continue
            h,w = frame.shape[:2]
            scale = MAX_DIM / max(h,w) if max(h,w) > MAX_DIM else 1.0
            if scale < 1.0:
                frame_in = cv2.resize(frame, (int(w*scale), int(h*scale)), interpolation=cv2.INTER_AREA)
            else:
                frame_in = frame

            t0 = time.time()
            res = model.track(frame_in, imgsz=IMGSZ, conf=CONF, persist=TRACK, verbose=False)[0]
            dt = time.time() - t0

            kpts_list = []
            boxes = res.boxes
            for i in range(len(boxes)):
                xy = boxes.xyxy[i].cpu().numpy().tolist()
                cls = int(boxes.cls[i].cpu().numpy()) if hasattr(boxes,'cls') else 0
                conf = float(boxes.conf[i].cpu().numpy()) if hasattr(boxes,'conf') else 0.0
                tid = int(boxes.id[i].cpu().numpy()) if boxes.id is not None else -1
                k = res.keypoints.xy[i].cpu().numpy() if res.keypoints is not None else np.zeros((17,2))
                c = res.keypoints.conf[i].cpu().numpy() if res.keypoints is not None and hasattr(res.keypoints,'conf') else np.ones((17,))
                kpts = []
                for j in range(len(k)):
                    kpts.append({"x": float(k[j,0]/scale) if scale>0 else float(k[j,0]),
                                 "y": float(k[j,1]/scale) if scale>0 else float(k[j,1]),
                                 "c": float(c[j])})
                kpts_list.append({"track_id": tid, "conf": conf, "bbox": xy, "kpts": kpts})

            await ws.send_text(json.dumps({"type":"pose", "fps": round(1.0/dt,1) if dt>0 else 0, "persons": kpts_list}, ensure_ascii=False))
    except WebSocketDisconnect:
        log.info("WebSocket desconectado")
    except Exception as e:
        log.exception(e)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app_pose:app", host="0.0.0.0", port=int(os.getenv("PORT",8080)), reload=False, workers=1, log_level="info")
