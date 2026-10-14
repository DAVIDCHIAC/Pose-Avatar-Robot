// Mapeo básico de keypoints COCO (17) a huesos humanoides
// 0=nose,1=left_eye,2=right_eye,3=left_ear,4=right_ear,5=left_shoulder,6=right_shoulder,7=left_elbow,8=right_elbow,9=left_wrist,10=right_wrist,11=left_hip,12=right_hip,13=left_knee,14=right_knee,15=left_ankle,16=right_ankle

export const COCO = {
  NOSE:0, L_EYE:1, R_EYE:2, L_EAR:3, R_EAR:4,
  L_SH:5, R_SH:6, L_EL:7, R_EL:8, L_WR:9, R_WR:10,
  L_HIP:11, R_HIP:12, L_KN:13, R_KN:14, L_AN:15, R_AN:16
};

export function getDir(a,b){ if(!a||!b) return {x:0,y:0,z:0}; return {x:b.x-a.x,y:b.y-a.y,z:b.z-a.z}; }
export function len3(v){ return Math.hypot(v.x,v.y,v.z); }

// Vector3 desde keypoint (usamos y invertido para Three.js)
export function kp3(k){ if(!k) return null; const c=k.c||0; if(c<0.25) return null; return {x:k.x, y:-k.y, z:0}; } // z plano por ahora
