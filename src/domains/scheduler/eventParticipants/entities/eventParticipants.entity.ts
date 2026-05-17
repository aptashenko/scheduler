import {Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {Member} from "../../members/entities/member.entity";
import {Event} from "../../events/entities/event.entity";
export enum EventParticipantStatus {
    Confirmed = 'confirmed',
    Waiting = 'waiting',
    Cancelled = 'cancelled',
}
@Entity('event_participants')
export class EventParticipant {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Event, (event) => event.participants)
    event: Event;

    @ManyToOne(() => Member, (member) => member.eventParticipants)
    member: Member;

    @Column({
        type: 'enum',
        enum: EventParticipantStatus,
    })
    status: EventParticipantStatus;

    @CreateDateColumn()
    createdAt: Date;
}