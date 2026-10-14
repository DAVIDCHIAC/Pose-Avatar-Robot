# Detección de Pose + Avatar 3D (YOLO Pose + Three.js)

Sistema en tiempo real: cámara web (PC/celular) → YOLOv8-Pose en servidor (FastAPI + WebSocket) → envía keypoints COCO al navegador → avatar 3D (Three.js + GLB) imita los movimientos. Pensado para desplegar en **AWS EC2** (con optimizaciones para t3.micro).

## Características

- **Pose detection**: `yolov8n-pose.pt` (Ultralytics). 17 keypoints COCO.
- **Seguimiento estable**: ByteTrack integrado en YOLO (track).
- **Web en tiempo real**: WebSocket (`/ws`) para baja latencia (frames JPEG → keypoints JSON).
- **Avatar 3D**: Three.js + modelo humanoide GLB con esqueleto (mapeo keypoints COCO → huesos).
- **Multidispositivo**: funciona en PC (webcam) y móvil (cámara frontal/trasera).
- **Optimizado para EC2**: downscale a 640px, `imgsz=320`, hilos limitados (2) para ahorrar RAM/CPU.

## Estructura

```
Pose-Avatar-Robot/
├── app_pose.py           # FastAPI + WebSocket + YOLO Pose
├── requirements.txt      # Dependencias
├── modelo/
│   └── yolov8n-pose.pt   # Modelo YOLOv8-Pose (6.5 MB)
├── static/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js        # Lógica cámara + WS + Three.js
│   │   └── poseMap.js    # Mapeo keypoints COCO → avatar
│   └── models/
│       └── humanoid.glb  # Avatar GLB (placeholder a cargar)
└── README.md
```

## Instalación (Local)

```bash
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux/macOS

pip install -r requirements.txt
```

## Ejecutar

```bash
python app_pose.py
```

Abrir: `http://localhost:8080`

## Despliegue en AWS EC2 (Ubuntu)

1. Crear instancia `t3.micro` (recomendado 1GB+, con swap opcional). Abrir puerto `8080`.
2. Subir proyecto: `scp -r . ubuntu@<IP>:/home/ubuntu/pose-avatar/`
3. Instalar dependencias:

```bash
sudo apt update && sudo apt install -y libgl1 libglib2.0-0
cd /home/ubuntu/pose-avatar
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Para CPU puro (EC2 sin GPU): torch ya instalado sirve
```

4. Ejecutar con Uvicorn (o systemd):

```bash
uvicorn app_pose:app --host 0.0.0.0 --port 8080 --workers 1 --log-level info
```

5. Abrir `http://<IP>:8080` desde celular/PC.

## Configuración

Variables de entorno (opcionales):

| Variable | Default | Uso |
|---|---|---|
| `MODEL_PATH` | `modelo/yolov8n-pose.pt` | Ruta modelo |
| `CONF` | `0.5` | Confianza mínima |
| `IMGSZ` | `320` | Tamaño entrada (320-416 mejor para t3.micro) |
| `MAX_DIM` | `640` | Máx ancho/alto cliente |
| `TRACK` | `1` | Activar ByteTrack (0/1) |

## Keypoints COCO (17)

0=nose,1=left_eye,2=right_eye,3=left_ear,4=right_ear,5=left_shoulder,6=right_shoulder,7=left_elbow,8=right_elbow,9=left_wrist,10=right_wrist,11=left_hip,12=right_hip,13=left_knee,14=right_knee,15=left_ankle,16=right_ankle

## Notas de rendimiento (t3.micro)

- `imgsz=320`, MAX_DIM 640: ~2–3 FPS (CPU). Aceptable para avatar.
- `imgsz=416`: ~1.5–2 FPS. Más estable.
- `imgsz=640`: ~0.8–1.2 FPS. Demasiado para t3.micro.

Para mejor fluidez (5–10 FPS): usar `g4dn.xlarge` (T4 GPU) o Jetson Nano/Orin.

## Avatar 3D

Se incluye mapeo básico en `static/js/poseMap.js`. Necesitas un **GLB humanoide con rig (skeleton)** en `static/models/humanoid.glb`. Si no existe, se muestra un avatar placeholder (esfera/cilindros) mientras pruebas.

## TODO

- [ ] Añadir modelo GLB libre (Mixamo humanoide ligero)
- [ ] Suavizado de keypoints (EMA/kalman) para reducir jitter
- [ ] Mapeo IK 3D (posición de manos/pies) más preciso
- [ ] Ajustes de espejo (mirror) según cámara frontal/trasera
- [ ] Mostrar FPS/latencia en UI