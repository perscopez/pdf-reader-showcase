'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function createBookTexture(coverColorHex: string, titleText: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  // Background cover color
  ctx.fillStyle = coverColorHex
  ctx.fillRect(0, 0, 512, 512)

  // Subtle border gold accent
  ctx.strokeStyle = '#d4af37'
  ctx.lineWidth = 12
  ctx.strokeRect(20, 20, 472, 472)
  ctx.strokeRect(32, 32, 448, 448)

  // Spine gold lines
  ctx.fillStyle = '#fef08a'
  ctx.font = 'bold 36px serif'
  ctx.textAlign = 'center'
  ctx.fillText('DK', 256, 120)

  // Title text
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText(titleText, 256, 260)

  // Decorative emblem
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(256, 360, 40, 0, Math.PI * 2)
  ctx.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export default function ThreeLibraryBackground() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Scene, Camera, Renderer
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x050505, 0.035)

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    camera.position.set(0, 0, 14)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffedd5, 1.2)
    scene.add(ambientLight)

    const mainSpot = new THREE.SpotLight(0xe50914, 8)
    mainSpot.position.set(10, 15, 10)
    mainSpot.angle = Math.PI / 4
    mainSpot.penumbra = 0.8
    scene.add(mainSpot)

    const goldPoint = new THREE.PointLight(0xfacc15, 6, 25)
    goldPoint.position.set(-8, -5, 5)
    scene.add(goldPoint)

    // Floating 3D Books
    const booksGroup = new THREE.Group()
    scene.add(booksGroup)

    const bookColors = ['#881337', '#1e3a8a', '#064e3b', '#451a03', '#1c1917', '#e50914']
    const bookTitles = ['BETA', 'KÜTÜPHANE', 'KODEX', 'HERMES', 'LİTERATÜR', 'ANTİGRAVİTY']
    const books: { mesh: THREE.Mesh; rotSpeedX: number; rotSpeedY: number; floatOffset: number; initialY: number }[] = []

    const bookGeometry = new THREE.BoxGeometry(2.2, 3.0, 0.5)

    for (let i = 0; i < 18; i += 1) {
      const color = bookColors[i % bookColors.length]
      const title = bookTitles[i % bookTitles.length]
      const texture = createBookTexture(color, title)

      const materials = [
        new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.9 }), // Pages right
        new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.9 }), // Pages left
        new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.9 }), // Top
        new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.9 }), // Bottom
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4, metalness: 0.1 }), // Front cover
        new THREE.MeshStandardMaterial({ color: color, roughness: 0.5 }), // Back cover
      ]

      const mesh = new THREE.Mesh(bookGeometry, materials)

      // Spread books randomly in 3D space around camera
      const x = (Math.random() - 0.5) * 22
      const y = (Math.random() - 0.5) * 16
      const z = (Math.random() - 0.5) * 12 - 2

      mesh.position.set(x, y, z)
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      )

      booksGroup.add(mesh)
      books.push({
        mesh,
        rotSpeedX: (Math.random() - 0.5) * 0.006,
        rotSpeedY: (Math.random() - 0.5) * 0.008,
        floatOffset: Math.random() * Math.PI * 2,
        initialY: y,
      })
    }

    // Drifting Library Dust Particles
    const particlesCount = 250
    const particlePositions = new Float32Array(particlesCount * 3)

    for (let i = 0; i < particlesCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 30
      particlePositions[i + 1] = (Math.random() - 0.5) * 20
      particlePositions[i + 2] = (Math.random() - 0.5) * 20
    }

    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))

    const particleMaterial = new THREE.PointsMaterial({
      color: 0xfde047,
      size: 0.08,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    })

    const particleSystem = new THREE.Points(particleGeometry, particleMaterial)
    scene.add(particleSystem)

    // Mouse Parallax Interaction
    let targetMouseX = 0
    let targetMouseY = 0
    let currentMouseX = 0
    let currentMouseY = 0

    const handleMouseMove = (e: MouseEvent) => {
      targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2
      targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        targetMouseX = (e.touches[0].clientX / window.innerWidth - 0.5) * 2
        targetMouseY = (e.touches[0].clientY / window.innerHeight - 0.5) * 2
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('touchmove', handleTouchMove)

    // Handle Resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }

    window.addEventListener('resize', handleResize)

    // Animation Loop
    let animationFrameId: number
    const clock = new THREE.Clock()

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      const elapsedTime = clock.getElapsedTime()

      // Smooth mouse lerp
      currentMouseX += (targetMouseX - currentMouseX) * 0.05
      currentMouseY += (targetMouseY - currentMouseY) * 0.05

      camera.position.x = currentMouseX * 2.5
      camera.position.y = -currentMouseY * 1.8
      camera.lookAt(0, 0, 0)

      // Rotate & float 3D books
      books.forEach(b => {
        b.mesh.rotation.x += b.rotSpeedX
        b.mesh.rotation.y += b.rotSpeedY
        b.mesh.position.y = b.initialY + Math.sin(elapsedTime * 1.2 + b.floatOffset) * 0.35
      })

      // Slowly rotate particle field
      particleSystem.rotation.y = elapsedTime * 0.02
      particleSystem.rotation.x = Math.sin(elapsedTime * 0.01) * 0.1

      renderer.render(scene, camera)
    }

    animate()

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    />
  )
}
