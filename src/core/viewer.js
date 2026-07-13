import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * Podgląd 3D. Cała geometria narzędzi budowana jest w układzie Z-w-górę
 * (jak w druku 3D, w milimetrach). Grupa `content` jest obrócona tak,
 * żeby oś Z geometrii wskazywała w górę ekranu.
 */
export function createViewer(container) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x11141a)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
  camera.position.set(140, 110, 140)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  // Światła
  const hemi = new THREE.HemisphereLight(0xdde4ff, 0x30281a, 1.1)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(120, 180, 90)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5)
  fill.position.set(-140, 60, -100)
  scene.add(fill)

  // Siatka "stołu drukarki"
  const grid = new THREE.GridHelper(300, 30, 0x39404e, 0x232833)
  grid.position.y = -0.05
  scene.add(grid)

  // Zawartość — geometria Z-up wyświetlana w świecie Y-up
  const content = new THREE.Group()
  content.rotation.x = -Math.PI / 2
  scene.add(content)

  function resize() {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  new ResizeObserver(resize).observe(container)
  resize()

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })

  /** Podmienia wyświetlaną zawartość. Przyjmuje Mesh/Group lub tablicę. */
  function setContent(objects) {
    content.clear()
    const arr = Array.isArray(objects) ? objects : [objects]
    for (const o of arr) if (o) content.add(o)
  }

  /** Ustawia kamerę tak, żeby cała zawartość była widoczna. */
  function fit() {
    const box = new THREE.Box3().setFromObject(content)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z, 10)
    const dir = new THREE.Vector3(1, 0.75, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, radius * 1.9)
    camera.near = radius / 100
    camera.far = radius * 40
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    controls.update()
  }

  return { scene, camera, renderer, controls, content, setContent, fit }
}

/** Domyślny materiał podglądu (bursztynowy „filament"). */
export function previewMaterial(color = 0xf2a33c) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
}

/** Drugi kolor — np. dla drugiej połówki formy. */
export function previewMaterialAlt(color = 0x4fa3f7) {
  return previewMaterial(color)
}
