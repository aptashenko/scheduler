import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from "typeorm";
import {EventParticipant} from "../../eventParticipants/entities/eventParticipants.entity";

@Entity('members')
export class Member {
    @PrimaryGeneratedColumn()
    id: number;
    @Column()
    email: string;
    @OneToMany(() => EventParticipant, (participant) => participant.member)
    eventParticipants: EventParticipant[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
