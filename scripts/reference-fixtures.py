"""Development-only OpenCV parity baseline; never used by the browser application."""
import json
from pathlib import Path
import cv2
import numpy as np

root = Path(__file__).resolve().parent.parent
detector = cv2.FaceDetectorYN.create(str(root / 'public/models/face_detection_yunet_2023mar.onnx'), '', (640, 640), 0.8, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(str(root / 'public/models/face_recognition_sface_2021dec.onnx'), '')
records = {}
for name in ['lena.jpg', 'messi5.jpg']:
    image = cv2.imread(str(root / 'tests/fixtures' / name))
    # Upscale Messi so its face clears the deliberately conservative 60px quality gate.
    if name == 'messi5.jpg':
        image = cv2.resize(image, (image.shape[1]*2, image.shape[0]*2))
        cv2.imwrite(str(root / 'tests/fixtures/messi-large.png'), image)
    resized = cv2.resize(image, (640, 640))
    _, faces = detector.detect(resized)
    if faces is None:
        records[name] = {'faceCount': 0}
        continue
    face = faces[0].copy()
    face[:14:2] *= image.shape[1]/640
    face[1:14:2] *= image.shape[0]/640
    crop = recognizer.alignCrop(image, face)
    embedding = recognizer.feature(crop).reshape(-1)
    embedding /= np.linalg.norm(embedding)
    records[name] = {'faceCount':len(faces),'box':face[:4].tolist(),'landmarks':face[4:14].reshape(5,2).tolist(),'embedding':embedding.tolist()}
result = {'opencvVersion':cv2.__version__,'detectorInput':[640,640],'records':records}
(root / 'tests/fixtures/native-reference.json').write_text(json.dumps(result, indent=2))
print(json.dumps({name:{'faceCount':value['faceCount'],'box':value.get('box')} for name,value in records.items()},indent=2))
