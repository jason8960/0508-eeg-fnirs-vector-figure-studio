/**
 * Python emitter for the 3.5D cortical projection figure.
 *
 * The JS chart procedurally generates a brain-like deformed-ellipsoid
 * mesh and projects it to SVG triangles with a painter's algorithm.
 * Reproducing the projection exactly in matplotlib is unhelpful — the
 * generated script just renders the same procedural mesh as a 3D
 * surface using `mpl_toolkits.mplot3d.Axes3D.plot_trisurf`, with the
 * activation field driving face colours via the chosen colormap. The
 * mesh-building algorithm is inlined verbatim so the script needs no
 * external data.
 */
import { pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';
import type { Hotspot } from './mesh';

export interface Cortical3dPythonInput {
  title: string;
  caption: string;
  yaw: number;
  pitch: number;
  colormapName: string;
  opacity: number;
  meshLat: number;
  meshLong: number;
  hotspots: ReadonlyArray<Hotspot>;
  colorbarLabel: string;
}

export function emitCortical3dPython(input: Cortical3dPythonInput): string {
  const {
    title,
    caption,
    yaw,
    pitch,
    colormapName,
    opacity,
    meshLat,
    meshLong,
    hotspots,
    colorbarLabel,
  } = input;

  const hotspotLines = hotspots
    .map(
      (h) =>
        `    {"cx": ${pyNum(h.cx)}, "cy": ${pyNum(h.cy)}, "cz": ${pyNum(h.cz)}, "amp": ${pyNum(h.amp)}, "sigma": ${pyNum(h.sigma)}},`,
    )
    .join('\n');

  return `${pythonHeader({
    title,
    caption,
    description:
      'Procedural deformed-ellipsoid brain mesh rendered as a 3D surface with vertex-activation colouring.',
  })}from mpl_toolkits.mplot3d import Axes3D  # noqa: F401
from matplotlib.tri import Triangulation

YAW = ${pyNum(yaw)}
PITCH = ${pyNum(pitch)}
COLORMAP = ${pyStr(colormapName)}
OPACITY = ${pyNum(opacity)}
MESH_U = ${pyNum(meshLat)}
MESH_V = ${pyNum(meshLong)}
COLORBAR_LABEL = ${pyStr(colorbarLabel)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}

HOTSPOTS = [
${hotspotLines}
]


def build_mesh(u_steps: int, v_steps: int):
    vertices = []
    for i in range(v_steps + 1):
        phi = (i / v_steps) * np.pi
        for j in range(u_steps):
            theta = (j / u_steps) * 2 * np.pi
            rx, ry, rz = 1.05, 0.85, 1.25
            x = rx * np.sin(phi) * np.cos(theta)
            y = ry * np.cos(phi)
            z = rz * np.sin(phi) * np.sin(theta)
            sulcus = np.exp(-(np.cos(theta) ** 2) * 22) * np.sin(phi) * 0.13
            x = x * (1 - sulcus)
            ripple = np.sin(theta * 6) * 0.045 + np.cos(phi * 8 + theta * 3) * 0.03
            r = 1 + ripple
            vertices.append((x * r, y * r, z * r))
    triangles = []
    def idx(i, j):
        return i * u_steps + ((j + u_steps) % u_steps)
    for i in range(v_steps):
        for j in range(u_steps):
            a = idx(i, j)
            b = idx(i + 1, j)
            c = idx(i + 1, j + 1)
            d = idx(i, j + 1)
            triangles.append((a, b, c))
            triangles.append((a, c, d))
    return np.array(vertices), np.array(triangles)


def activation(verts: np.ndarray) -> np.ndarray:
    out = np.zeros(verts.shape[0])
    for h in HOTSPOTS:
        d2 = (verts[:, 0] - h["cx"]) ** 2 + (verts[:, 1] - h["cy"]) ** 2 + (verts[:, 2] - h["cz"]) ** 2
        out += h["amp"] * np.exp(-d2 / (2 * h["sigma"] ** 2))
    return out


def render() -> None:
    verts, tris = build_mesh(MESH_U, MESH_V)
    act = activation(verts)
    act_min, act_max = float(act.min()), float(act.max())
    if act_max <= act_min:
        act_max = act_min + 1.0
    norm = (act - act_min) / (act_max - act_min)
    cmap = plt.get_cmap(COLORMAP)
    face_act = norm[tris].mean(axis=1)
    face_colors = cmap(face_act)
    face_colors[:, 3] = OPACITY

    fig = plt.figure(figsize=(8.5, 6.5), constrained_layout=True)
    ax = fig.add_subplot(111, projection="3d")
    triang = Triangulation(verts[:, 0], verts[:, 1], tris)
    surf = ax.plot_trisurf(
        triang,
        verts[:, 2],
        linewidth=0.0,
        antialiased=True,
        shade=False,
    )
    surf.set_facecolors(face_colors)

    yaw_deg = np.degrees(YAW)
    pitch_deg = np.degrees(PITCH)
    ax.view_init(elev=90 - pitch_deg * 90 / (np.pi / 2), azim=yaw_deg)
    ax.set_box_aspect((1, 1, 1))
    ax.set_axis_off()

    sm = plt.cm.ScalarMappable(cmap=cmap)
    sm.set_array(act)
    cbar = fig.colorbar(sm, ax=ax, fraction=0.03, pad=0.02)
    cbar.set_label(COLORBAR_LABEL)

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, 0.0, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
