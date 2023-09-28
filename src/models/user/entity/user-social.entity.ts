import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Expose, plainToClass } from 'class-transformer';

import { SocialType } from '@my-common/constants';
import { User } from './user.entity';

@Entity()
@Index(['social', 'socialId'], { unique: true })
export class UserSocial {
  @Expose()
  @PrimaryGeneratedColumn()
  public id: number;

  @Expose()
  @Column({ type: 'enum', enum: SocialType })
  public social: SocialType;

  @Expose()
  @Column({ type: 'bigint' })
  public socialId: number;

  @Expose()
  @Column({ type: 'character varying', length: 32, nullable: true })
  public username?: string;

  @Expose()
  @Column({ type: 'character varying', length: 64, nullable: true })
  public displayname?: string;

  @Expose()
  @Column({ type: 'character varying', length: 120, nullable: true })
  public profileUrl?: string;

  @Expose()
  @Column({ type: 'character varying', length: 255, nullable: true })
  public avatarUrl?: string;

  @Expose()
  @Column({ type: 'character varying', length: 16, nullable: true })
  public groupName?: string;

  @Column({ type: 'boolean', default: false })
  public isBlockedBot: boolean;

  /** Has DM, otherwise received from chat */
  @Column({ type: 'boolean', default: false })
  public hasDM: boolean;

  @Expose()
  @ManyToOne(() => User, (user) => user.socials)
  @JoinColumn()
  public user?: User;

  @Expose()
  @Column({ nullable: true })
  public userId: number;

  @Expose()
  @CreateDateColumn()
  public createdAt: Date;

  @Expose()
  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(input?: Partial<UserSocial>) {
    if (input) {
      Object.assign(this, plainToClass(UserSocial, input));
    }
  }
}
