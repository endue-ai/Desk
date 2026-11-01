// The memory of a PPMd var.H model, after the public-domain PPMd var.H by Dmitry Shkarin and Igor
// Pavlov's LZMA SDK (Ppmd7), as carried by libarchive. One ArrayBuffer: the text area (symbols seen
// so far) grows up from the start, 12-byte units are cut from the end, and freed blocks wait on
// free lists by size until a glue pass merges neighbours. Pointers are byte offsets; 0 is null.
// Units stay 4-byte aligned (AlignOffset), so 32-bit fields use the Uint32Array view.

export const UNIT_SIZE = 12;
const NUM_INDEXES = 38;

/** Units in a block of each size index. */
export const I2U = new Uint8Array(NUM_INDEXES);
/** The size index of a block of n units, at n - 1. */
export const U2I = new Uint8Array(128);
for (let i = 0, k = 0; i < NUM_INDEXES; i++) {
  const step = i >= 12 ? 4 : (i >> 2) + 1;
  for (let j = 0; j < step; j++) U2I[k++] = i;
  I2U[i] = k;
}

export class SubAllocator {
  constructor() {
    /** Bytes the model may use, 0 before the first allocate. */
    this.size = 0;
    this.alignOffset = 0;
    this.u8 = new Uint8Array(0);
    this.u16 = new Uint16Array(0);
    this.u32 = new Uint32Array(0);
    /** The first free block of each size index, 0 when there is none. */
    this.freeList = new Uint32Array(NUM_INDEXES);
    this.glueCount = 0;
    this.text = 0;
    this.unitsStart = 0;
    this.loUnit = 0;
    this.hiUnit = 0;
  }

  /** Makes room for `size` bytes, keeping the buffer when the size is unchanged. @param {number} size */
  allocate(size) {
    if (this.size === size) return;
    // The unit past the end is the list head of glueFreeBlocks.
    const alignOffset = 4 - (size & 3);
    const buffer = new ArrayBuffer(alignOffset + size + UNIT_SIZE);
    this.u8 = new Uint8Array(buffer);
    this.u16 = new Uint16Array(buffer);
    this.u32 = new Uint32Array(buffer);
    this.alignOffset = alignOffset;
    this.size = size;
  }

  /** Empties the text and the units: the memory half of RestartModel. */
  initUnits() {
    this.freeList.fill(0);
    this.text = this.alignOffset;
    this.hiUnit = this.text + this.size;
    this.unitsStart = this.hiUnit - Math.floor(this.size / 96) * 7 * UNIT_SIZE;
    this.loUnit = this.unitsStart;
    this.glueCount = 0;
  }

  /** @param {number} node @param {number} indx */
  insertNode(node, indx) {
    this.u32[node >> 2] = this.freeList[indx];
    this.freeList[indx] = node;
  }

  /** @param {number} indx */
  removeNode(indx) {
    const node = this.freeList[indx];
    this.freeList[indx] = this.u32[node >> 2];
    return node;
  }

  /**
   * Frees what lies past the first I2U[newIndx] units of a block of index oldIndx.
   * @param {number} ptr @param {number} oldIndx @param {number} newIndx
   */
  splitBlock(ptr, oldIndx, newIndx) {
    const nu = I2U[oldIndx] - I2U[newIndx];
    const rest = ptr + I2U[newIndx] * UNIT_SIZE;
    let i = U2I[nu - 1];
    if (I2U[i] !== nu) {
      const k = I2U[--i];
      this.insertNode(rest + k * UNIT_SIZE, nu - k - 1);
    }
    this.insertNode(rest, i);
  }

  /**
   * Merges free blocks that touch and sorts them back onto the free lists. A node: Stamp u16 (0 when
   * free), NU u16, Next u32, Prev u32. A used unit never starts with two zero bytes.
   */
  glueFreeBlocks() {
    const { u16, u32, freeList } = this;
    const head = this.alignOffset + this.size;
    let n = head;
    this.glueCount = 255;
    // A doubly-linked list of every free block.
    for (let i = 0; i < NUM_INDEXES; i++) {
      const nu = I2U[i];
      let next = freeList[i];
      freeList[i] = 0;
      while (next !== 0) {
        const node = next;
        u32[(node + 4) >> 2] = n;
        u32[(n + 8) >> 2] = node;
        n = node;
        next = u32[node >> 2];
        u16[node >> 1] = 0;
        u16[(node + 2) >> 1] = nu;
      }
    }
    u16[head >> 1] = 1;
    u32[(head + 4) >> 2] = n;
    u32[(n + 8) >> 2] = head;
    if (this.loUnit !== this.hiUnit) u16[this.loUnit >> 1] = 1;
    // Glue each block to the free blocks right after it.
    while (n !== head) {
      const node = n;
      let nu = u16[(node + 2) >> 1];
      for (;;) {
        const node2 = node + nu * UNIT_SIZE;
        nu += u16[(node2 + 2) >> 1];
        if (u16[node2 >> 1] !== 0 || nu >= 0x10000) break;
        const prev = u32[(node2 + 8) >> 2];
        const next = u32[(node2 + 4) >> 2];
        u32[(prev + 4) >> 2] = next;
        u32[(next + 8) >> 2] = prev;
        u16[(node + 2) >> 1] = nu;
      }
      n = u32[(node + 4) >> 2];
    }
    // Back onto the free lists, in pieces of at most 128 units.
    for (n = u32[(head + 4) >> 2]; n !== head; ) {
      let node = n;
      const next = u32[(node + 4) >> 2];
      let nu = u16[(node + 2) >> 1];
      for (; nu > 128; nu -= 128, node += 128 * UNIT_SIZE) this.insertNode(node, NUM_INDEXES - 1);
      let i = U2I[nu - 1];
      if (I2U[i] !== nu) {
        const k = I2U[--i];
        this.insertNode(node + k * UNIT_SIZE, nu - k - 1);
      }
      this.insertNode(node, i);
      n = next;
    }
  }

  /** A block of index indx when the fast paths failed, or 0 when memory is full. @param {number} indx */
  allocUnitsRare(indx) {
    if (this.glueCount === 0) {
      this.glueFreeBlocks();
      if (this.freeList[indx] !== 0) return this.removeNode(indx);
    }
    let i = indx;
    do {
      if (++i === NUM_INDEXES) {
        const numBytes = I2U[indx] * UNIT_SIZE;
        this.glueCount--;
        if (this.unitsStart - this.text <= numBytes) return 0;
        this.unitsStart -= numBytes;
        return this.unitsStart;
      }
    } while (this.freeList[i] === 0);
    const block = this.removeNode(i);
    this.splitBlock(block, i, indx);
    return block;
  }

  /** A block of I2U[indx] units, or 0 when memory is full. @param {number} indx */
  allocUnits(indx) {
    if (this.freeList[indx] !== 0) return this.removeNode(indx);
    const numBytes = I2U[indx] * UNIT_SIZE;
    const lo = this.loUnit;
    if (numBytes <= this.hiUnit - lo) {
      this.loUnit = lo + numBytes;
      return lo;
    }
    return this.allocUnitsRare(indx);
  }

  /** One unit for a context, or 0 when memory is full. */
  allocContext() {
    if (this.hiUnit !== this.loUnit) {
      this.hiUnit -= UNIT_SIZE;
      return this.hiUnit;
    }
    if (this.freeList[0] !== 0) return this.removeNode(0);
    return this.allocUnitsRare(0);
  }

  /** @param {number} dst @param {number} src @param {number} nu */
  copyUnits(dst, src, nu) {
    const u32 = this.u32;
    let d = dst >> 2;
    let s = src >> 2;
    for (let n = nu * 3; n > 0; n--) u32[d++] = u32[s++];
  }

  /**
   * Room for one more state after the 2 * oldNU in a block of oldNU units: the same block, a new one,
   * or 0 when memory is full.
   * @param {number} oldPtr @param {number} oldNU
   */
  expandUnits(oldPtr, oldNU) {
    const i = U2I[oldNU - 1];
    if (i === U2I[oldNU]) return oldPtr;
    const ptr = this.allocUnits(i + 1);
    if (ptr === 0) return 0;
    this.copyUnits(ptr, oldPtr, oldNU);
    this.insertNode(oldPtr, i);
    return ptr;
  }

  /** @param {number} oldPtr @param {number} oldNU @param {number} newNU */
  shrinkUnits(oldPtr, oldNU, newNU) {
    const i0 = U2I[oldNU - 1];
    const i1 = U2I[newNU - 1];
    if (i0 === i1) return oldPtr;
    if (this.freeList[i1] !== 0) {
      const ptr = this.removeNode(i1);
      this.copyUnits(ptr, oldPtr, newNU);
      this.insertNode(oldPtr, i0);
      return ptr;
    }
    this.splitBlock(oldPtr, i0, i1);
    return oldPtr;
  }

  /** @param {number} ptr @param {number} nu */
  freeUnits(ptr, nu) {
    this.insertNode(ptr, U2I[nu - 1]);
  }
}
