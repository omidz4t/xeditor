import { describe, expect, it } from 'vitest'
import {
  addTableColumn,
  addTableRow,
  cellText,
  createDefaultTableData,
  removeTableColumn,
  removeTableRow,
} from './table'

function filledTable() {
  const table = createDefaultTableData()
  table.rows[0][0] = { content: [{ text: 'Name' }] }
  table.rows[0][1] = { content: [{ text: 'Age' }] }
  table.rows[0][2] = { content: [{ text: 'City' }] }
  table.rows[1][0] = { content: [{ text: 'Ada' }] }
  table.rows[1][1] = { content: [{ text: '36' }] }
  table.rows[1][2] = { content: [{ text: 'London' }] }
  return table
}

describe('table structural ops', () => {
  it('addTableRow preserves existing cell content', () => {
    const next = addTableRow(filledTable())

    expect(next.rows).toHaveLength(3)
    expect(cellText(next.rows[0][0])).toBe('Name')
    expect(cellText(next.rows[1][2])).toBe('London')
    expect(cellText(next.rows[2][0])).toBe('')
    expect(next.rows[2]).toHaveLength(3)
  })

  it('addTableColumn preserves existing cell content', () => {
    const next = addTableColumn(filledTable())

    expect(next.rows[0]).toHaveLength(4)
    expect(cellText(next.rows[0][0])).toBe('Name')
    expect(cellText(next.rows[1][2])).toBe('London')
    expect(cellText(next.rows[0][3])).toBe('')
  })

  it('removeTableRow keeps other rows intact', () => {
    const next = removeTableRow(filledTable(), 1)

    expect(next.rows).toHaveLength(1)
    expect(cellText(next.rows[0][0])).toBe('Name')
    expect(cellText(next.rows[0][2])).toBe('City')
  })

  it('removeTableColumn keeps other columns intact', () => {
    const next = removeTableColumn(filledTable(), 1)

    expect(next.rows[0]).toHaveLength(2)
    expect(cellText(next.rows[0][0])).toBe('Name')
    expect(cellText(next.rows[0][1])).toBe('City')
    expect(cellText(next.rows[1][1])).toBe('London')
  })
})
