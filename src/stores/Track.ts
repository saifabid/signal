import { observable, action, transaction, computed } from "mobx"
import { list, map, primitive, serializable } from "serializr"
import _ from "lodash"

import { MidiEvent } from "midi/MidiEvent"
import { getInstrumentName } from "midi/GM"

import orArrayOf from "helpers/orArrayOf"

function lastValue(arr, prop) {
  const last = _.last(arr)
  return last && last[prop]
}

export default class Track {
  @serializable(list(map(orArrayOf(primitive())))) @observable.shallow 
  events: any[] = []
  
  @serializable @observable 
  lastEventId = 0

  @serializable @observable 
  channel: number|undefined = undefined

  getEventById = (id: number) => _.find(this.events, e => e.id === id)

  private _updateEvent(id: number, obj: any) {
    const anObj = this.getEventById(id)
    if (!anObj) {
      console.warn(`unknown id: ${id}`)
      return null
    }
    const newObj = Object.assign({}, anObj, obj)
    if (_.isEqual(newObj, anObj)) {
      return null
    }
    Object.assign(anObj, obj)
    return anObj
  }

  @action updateEvent(id: number, obj: any) {
    const result = this._updateEvent(id, obj)
    if (result) {
      this.updateEndOfTrack()
      this.sortByTick()
    }
    return result
  }

  @action updateEvents(events: any[]) {
    transaction(() => {
      events.forEach(event => {
        this._updateEvent(event.id, event)
      })
    })
    this.updateEndOfTrack()
    this.sortByTick()
  }

  @action removeEvent(id: number) {
    const obj = this.getEventById(id)
    this.events = _.without(this.events, obj)
    this.updateEndOfTrack()
  }

  @action removeEvents(ids: number[]) {
    const objs = ids.map(id => this.getEventById(id))
    this.events = _.difference(this.events, objs)
    this.updateEndOfTrack()
  }

  // ソート、通知を行わない内部用の addEvent
  _addEvent(e: any) {
    e.id = this.lastEventId
    this.lastEventId++
    this.events.push(e)

    if (e.tick === undefined) {
      const lastEvent = this.getEventById(this.lastEventId)
      e.tick = e.deltaTime + (lastEvent ? lastEvent.tick : 0)
    }
    if (e.type === "channel") {
      e.channel = this.channel
    }
    return e
  }

  @action addEvent(e: any) {
    this._addEvent(e)
    this.didAddEvent()
    return e
  }

  @action addEvents(events: any) {
    let result
    transaction(() => {
      result = events.map(e => this._addEvent(e))
    })
    this.didAddEvent()
    return result
  }

  didAddEvent() {
    this.updateEndOfTrack()
    this.sortByTick()
  }

  @action sortByTick() {
    this.events = _.sortBy(this.events, "tick")
  }

  updateEndOfTrack() {
    this.endOfTrack = _.chain(this.events)
      .map(e => e.tick + (e.duration || 0))
      .max()
      .value()
  }

  changeChannel(channel: number) {
    this.channel = channel

    for (let e of this.events) {
      if (e.type === "channel") {
        e.channel = channel
      }
    }
  }

  transaction(func) {
    transaction(() => func(this))
  }

  /* helper */

  _findTrackNameEvent() {
    return this.events.filter(t => t.subtype === "trackName")
  }

  _findProgramChangeEvents() {
    return this.events.filter(t => t.subtype === "programChange")
  }

  _findEndOfTrackEvents() {
    return this.events.filter(t => t.subtype === "endOfTrack")
  }

  _findVolumeEvents() {
    return this.events.filter(t => t.subtype === "controller" && t.controllerType === 7)
  }

  _findPanEvents() {
    return this.events.filter(t => t.subtype === "controller" && t.controllerType === 10)
  }

  _findSetTempoEvents() {
    return this.events.filter(t => t.subtype === "setTempo")
  }

  _updateLast(arr, obj) {
    if (arr.length > 0) {
      this.updateEvent(_.last(arr).id, obj)
    }
  }

  createOrUpdate(newEvent) {
    const events = this.events.filter(e =>
      e.type === newEvent.type &&
      e.subtype === newEvent.subtype &&
      e.tick === newEvent.tick)

    if (events.length > 0) {
      this.transaction(it => {
        events.forEach(e => {
          it.updateEvent(e.id, { ...newEvent, id: e.id })
        })
      })
      return events[0]
    } else {
      return this.addEvent(newEvent)
    }
  }

  // 表示用の名前 トラック名がなければトラック番号を表示する
  get displayName() {
    if (this.name && this.name.length > 0) {
      return this.name
    }
    return `Track ${this.channel}`
  }

  get instrumentName() {
    if (this.isRhythmTrack) {
      return "Standard Drum Kit"
    }
    const program = this.programNumber
    if (program !== undefined) {
      return getInstrumentName(program)
    }
    return undefined
  }

  get name(): string {
    return lastValue(this._findTrackNameEvent(), "text")
  }

  set name(value: string) {
    this._updateLast(this._findTrackNameEvent(), { value })
  }

  get volume(): number {
    return lastValue(this._findVolumeEvents(), "value")
  }

  set volume(value: number) {
    this._updateLast(this._findVolumeEvents(), { value })
  }

  get pan(): number {
    return lastValue(this._findPanEvents(), "value")
  }

  set pan(value: number) {
    this._updateLast(this._findPanEvents(), { value })
  }

  @computed 
  get endOfTrack(): number {
    return lastValue(this._findEndOfTrackEvents(), "tick")
  }

  set endOfTrack(tick: number) {
    this._updateLast(this._findEndOfTrackEvents(), { tick })
  }

  get programNumber(): number {
    return lastValue(this._findProgramChangeEvents(), "value")
  }

  set programNumber(value: number) {
    this._updateLast(this._findProgramChangeEvents(), { value })
  }

  get tempo(): number {
    return 60000000 / lastValue(this._findSetTempoEvents(), "microsecondsPerBeat")
  }

  set tempo(bpm: number) {
    const microsecondsPerBeat = 60000000 / bpm
    this._updateLast(this._findSetTempoEvents(), { microsecondsPerBeat })
  }

  get isConductorTrack() {
    return this.channel === undefined
  }

  get isRhythmTrack() {
    return this.channel === 9
  }
}
